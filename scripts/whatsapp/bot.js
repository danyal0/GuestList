/**
 * WhatsApp ↔ MKE Plays bridge
 *
 * Long-running Node process (not a Next.js serverless function).
 * Uses whatsapp-web.js + LocalAuth, classifies chat with xAI/Grok,
 * then POSTs to Next.js App Router endpoints.
 *
 * Run:  npm run whatsapp:bot
 * First boot prints a QR code — scan it with WhatsApp → Linked Devices.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Prefer repo-root `.env`, then `scripts/whatsapp/.env`.
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const {
  normalizeGroupId,
  parseInviteCode,
  createGroupResolver,
  extractPhone,
  serializeWhatsappMessageId,
  extractSenderIdentity,
} = require('./group-resolve');

// ─────────────────────────── Config ───────────────────────────

const WHATSAPP_GROUP_NAME = process.env.WHATSAPP_GROUP_NAME || 'Tennis Group';
const WHATSAPP_BOT_TOKEN = process.env.WHATSAPP_BOT_TOKEN;
const XAI_API_KEY = process.env.XAI_API_KEY;
const XAI_API_URL =
  process.env.XAI_API_URL || 'https://api.x.ai/v1/chat/completions';
const XAI_MODEL =
  process.env.XAI_MODEL || 'grok-4-1-fast-non-reasoning-latest';
const APP_BASE_URL =
  process.env.APP_BASE_URL ||
  process.env.NEXT_APP_URL ||
  'http://localhost:3000';
const MIN_CONFIDENCE = Number(process.env.WHATSAPP_MIN_CONFIDENCE || '0.6');

/** Reactions that short-circuit to RSVP_YES without calling Grok. */
const POSITIVE_REACTION_IDS = new Set([
  '👍',
  '👍🏻',
  '👍🏼',
  '👍🏽',
  '👍🏾',
  '👍🏿',
  '🎾',
  '✅',
  '🙌',
  '💪',
]);

const NEGATIVE_REACTION_IDS = new Set(['👎', '👎🏻', '👎🏼', '👎🏽', '👎🏾', '👎🏿', '❌', '🚫']);

if (!WHATSAPP_BOT_TOKEN) {
  console.error('[whatsapp-bot] Missing WHATSAPP_BOT_TOKEN in environment.');
  process.exit(1);
}
if (!XAI_API_KEY) {
  console.error('[whatsapp-bot] Missing XAI_API_KEY in environment.');
  process.exit(1);
}

// ─────────────────────────── Types (JSDoc) ───────────────────────────

/**
 * @typedef {'CREATE_EVENT' | 'RSVP_YES' | 'RSVP_NO' | 'IGNORE'} Intent
 * @typedef {{
 *   intent: Intent,
 *   confidence: number,
 *   extractedData: {
 *     title: string | null,
 *     suggestedTime: string | null,
 *     venue: string | null,
 *     locationName: string | null,
 *     address: string | null,
 *     latitude: number | null,
 *     longitude: number | null,
 *     instructions: string | null,
 *     notes: string | null,
 *     skillLevel: string | null,
 *     courtInfo: string | null,
 *     durationMinutes: number | null,
 *     timezone: string | null,
 *   }
 * }} AnalysisResult
 * @typedef {{
 *   kind: 'message' | 'reaction',
 *   text: string | null,
 *   reaction: string | null,
 *   senderPhone: string,
 *   senderLid?: string | null,
 *   senderJid?: string | null,
 *   senderName?: string | null,
 *   whatsappMessageId: string,
 *   targetMessageId: string | null,
 * }} AnalyzePayload
 */

const SYSTEM_PROMPT = `You are an expert tennis match organizer for Milwaukee, Wisconsin (MKE Plays).
Parse casual WhatsApp group chat about pickup tennis. Extract MAXIMUM structured detail.

Identify exactly one intent:
- CREATE_EVENT: proposing / scheduling a new match or hitting session
- RSVP_YES: confirming attendance for an existing match
- RSVP_NO: cancelling or declining
- IGNORE: banter / unrelated / insufficient signal

Milwaukee context (always assume local unless another city is explicit):
- Timezone: America/Chicago
- "lake front" / "lakefront" / "lake park" / "bradford" → Lake Park Tennis Courts, 3233 N Lake Dr, Milwaukee, WI 53211 (lat 43.0665, lng -87.8708)
- Veterans / McKinley → 1010 N Lincoln Memorial Dr, Milwaukee, WI 53202
- Humboldt Park, Washington Park, Wilson Park, Oak Creek, Wauwatosa/Hart Park are also common

Time intelligence (critical):
- Bare hours like "at 6", "6 tomorrow", "lets play at 6" for tennis almost always mean 6 PM, NOT 6 AM.
- Prefer PM for hours 1–8 when am/pm is omitted. Morning only if explicit (6am, sunrise, before work, early morning).
- suggestedTime MUST be ISO-8601 with America/Chicago offset when possible (e.g. 2026-07-29T18:00:00-05:00).
- If only a weekday/relative day is given, resolve relative to "now" in America/Chicago.

Extraction rules for CREATE_EVENT:
- Fill every field you can infer. Invent a short clear title if needed (e.g. "Lakefront tennis tomorrow 6pm").
- locationName = friendly court/park name; address = precise street address; include lat/lng when known from Milwaukee venues above.
- instructions = meetup tips, what to bring, how to find courts, parking, "bring balls", etc. Infer sensible defaults if not stated (e.g. "Meet at the Lake Park courts near Bradford Beach. Bring a can of balls if you can.").
- notes = anything else useful (weather contingency, open hit vs sets).
- skillLevel if implied (beginner/intermediate/advanced/all levels).
- courtInfo if mentioned (court #, indoor/outdoor, lights).
- durationMinutes default 90 if unspecified.
- Be slightly assertive on CREATE_EVENT when someone clearly wants to play; still IGNORE pure jokes.

Return ONLY one minified JSON object. No markdown.
Schema:
{"intent":"CREATE_EVENT"|"RSVP_YES"|"RSVP_NO"|"IGNORE","confidence":0.0,"extractedData":{"title":null,"suggestedTime":null,"venue":null,"locationName":null,"address":null,"latitude":null,"longitude":null,"instructions":null,"notes":null,"skillLevel":null,"courtInfo":null,"durationMinutes":90,"timezone":"America/Chicago"}}`;

// ─────────────────────────── xAI / Grok ───────────────────────────

/**
 * Call xAI Grok and parse a strict AnalysisResult.
 * @param {AnalyzePayload} payload
 * @returns {Promise<AnalysisResult>}
 */
async function analyzeWithxAI(payload) {
  const nowChi = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());

  const userContent = JSON.stringify({
    kind: payload.kind,
    text: payload.text,
    reaction: payload.reaction,
    nowAmericaChicago: nowChi,
    locale: 'Milwaukee, WI',
    hint:
      payload.kind === 'reaction'
        ? 'WhatsApp reaction on a prior message that may be a match invitation.'
        : 'WhatsApp group message about tennis in Milwaukee. Extract max structured fields. Bare hour → prefer PM.',
  });

  let response;
  try {
    response = await fetch(XAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: XAI_MODEL,
        temperature: 0,
        // Prefer structured JSON when the model/API supports it.
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      }),
    });
  } catch (err) {
    console.error('[whatsapp-bot] xAI network error:', err);
    return ignoreResult(0);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(
      `[whatsapp-bot] xAI HTTP ${response.status}: ${body.slice(0, 500)}`,
    );
    return ignoreResult(0);
  }

  let rawContent = '';
  try {
    const data = await response.json();
    rawContent =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.text ??
      '';
  } catch (err) {
    console.error('[whatsapp-bot] Failed to parse xAI response envelope:', err);
    return ignoreResult(0);
  }

  return parseAnalysisJson(rawContent);
}

/**
 * @param {string} raw
 * @returns {AnalysisResult}
 */
function parseAnalysisJson(raw) {
  if (!raw || typeof raw !== 'string') {
    return ignoreResult(0);
  }

  // Strip accidental markdown fences if the model ignores instructions.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    const intent = normalizeIntent(parsed?.intent);
    const confidence = clampConfidence(parsed?.confidence);
    const extracted = parsed?.extractedData ?? {};

    return {
      intent,
      confidence,
      extractedData: {
        title: nullableString(extracted.title),
        suggestedTime: nullableString(extracted.suggestedTime),
        venue: nullableString(extracted.venue),
        locationName: nullableString(extracted.locationName),
        address: nullableString(extracted.address),
        latitude: nullableNumber(extracted.latitude),
        longitude: nullableNumber(extracted.longitude),
        instructions: nullableString(extracted.instructions),
        notes: nullableString(extracted.notes),
        skillLevel: nullableString(extracted.skillLevel),
        courtInfo: nullableString(extracted.courtInfo),
        durationMinutes: nullableNumber(extracted.durationMinutes),
        timezone: nullableString(extracted.timezone) || 'America/Chicago',
      },
    };
  } catch (err) {
    console.error(
      '[whatsapp-bot] Failed to parse xAI JSON payload:',
      err,
      'raw=',
      cleaned.slice(0, 300),
    );
    return ignoreResult(0);
  }
}

/** @param {unknown} value @returns {Intent} */
function normalizeIntent(value) {
  const allowed = new Set(['CREATE_EVENT', 'RSVP_YES', 'RSVP_NO', 'IGNORE']);
  return allowed.has(value) ? /** @type {Intent} */ (value) : 'IGNORE';
}

/** @param {unknown} value @returns {number} */
function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** @param {unknown} value @returns {string | null} */
function nullableString(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

/** @param {unknown} value @returns {number | null} */
function nullableNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** @param {number} confidence @returns {AnalysisResult} */
function ignoreResult(confidence) {
  return {
    intent: 'IGNORE',
    confidence,
    extractedData: {
      title: null,
      suggestedTime: null,
      venue: null,
      locationName: null,
      address: null,
      latitude: null,
      longitude: null,
      instructions: null,
      notes: null,
      skillLevel: null,
      courtInfo: null,
      durationMinutes: null,
      timezone: 'America/Chicago',
    },
  };
}

// ─────────────────────────── Backend HTTP ───────────────────────────

/**
 * @param {string} path
 * @param {Record<string, unknown>} body
 */
async function postToApp(path, body) {
  const url = `${APP_BASE_URL.replace(/\/$/, '')}${path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-whatsapp-bot-token': WHATSAPP_BOT_TOKEN,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      console.error(
        `[whatsapp-bot] POST ${path} → ${res.status}`,
        json ?? text.slice(0, 400),
      );
      return null;
    }

    console.log(`[whatsapp-bot] POST ${path} → ${res.status}`, json);
    return json;
  } catch (err) {
    console.error(`[whatsapp-bot] POST ${path} failed:`, err);
    return null;
  }
}

/**
 * Route an analysis result to the correct Next.js API.
 * @param {AnalyzePayload} payload
 * @param {AnalysisResult} analysis
 */
async function dispatchIntent(payload, analysis) {
  if (analysis.intent === 'IGNORE' || analysis.confidence < MIN_CONFIDENCE) {
    console.log(
      `[whatsapp-bot] Ignoring (intent=${analysis.intent}, confidence=${analysis.confidence})`,
    );
    return;
  }

  if (analysis.intent === 'CREATE_EVENT') {
    const x = analysis.extractedData;
    const body = {
      senderPhone: payload.senderPhone,
      senderLid: payload.senderLid ?? null,
      senderJid: payload.senderJid ?? null,
      senderName: payload.senderName ?? null,
      messageBody: payload.text ?? '',
      whatsappMessageId: payload.whatsappMessageId,
      title: x.title,
      suggestedTime: x.suggestedTime,
      venue: x.venue,
      locationName: x.locationName,
      address: x.address,
      latitude: x.latitude,
      longitude: x.longitude,
      instructions: x.instructions,
      notes: x.notes,
      skillLevel: x.skillLevel,
      courtInfo: x.courtInfo,
      durationMinutes: x.durationMinutes,
      timezone: x.timezone || 'America/Chicago',
      confidence: analysis.confidence,
    };
    if ((!body.senderPhone && !body.senderLid) || !body.whatsappMessageId) {
      console.error(
        '[whatsapp-bot] Refusing CREATE_EVENT POST — missing fields:',
        {
          senderPhone: body.senderPhone,
          senderLid: body.senderLid,
          whatsappMessageId: body.whatsappMessageId,
          senderJid: body.senderJid,
        },
      );
      return;
    }
    console.log(
      `[whatsapp-bot] CREATE_EVENT extract title=${body.title} time=${body.suggestedTime} place=${body.locationName || body.venue} addr=${body.address}`,
    );
    await postToApp('/api/whatsapp/create-event', body);
    return;
  }

  if (analysis.intent === 'RSVP_YES' || analysis.intent === 'RSVP_NO') {
    const targetId =
      payload.targetMessageId || payload.whatsappMessageId;
    await postToApp('/api/whatsapp/rsvp', {
      whatsappMessageId: targetId,
      reactorPhone: payload.senderPhone,
      reactorLid: payload.senderLid ?? null,
      reactorJid: payload.senderJid ?? null,
      status: analysis.intent === 'RSVP_YES' ? 'attending' : 'cancelled',
      confidence: analysis.confidence,
    });
  }
}

// ─────────────────────────── WhatsApp helpers ───────────────────────────

/**
 * Cached WhatsApp group JID resolver.
 * Resolution order:
 *   1) WHATSAPP_GROUP_ID
 *   2) WHATSAPP_GROUP_INVITE / invite URL via getInviteInfo
 *   3) Auto-learn from the first inbound …@g.us message (default on)
 * getChats()/getChat() are intentionally avoided on the message path.
 */
const groupResolver = createGroupResolver({
  groupId: process.env.WHATSAPP_GROUP_ID,
  autoLearn: process.env.WHATSAPP_AUTO_LEARN_GROUP !== 'false',
  log: (...args) => console.log(...args),
});

/**
 * @returns {Promise<string | null>}
 */
async function resolveTargetGroupId() {
  try {
    if (groupResolver.getId()) return groupResolver.getId();

    const inviteCode = parseInviteCode(
      process.env.WHATSAPP_GROUP_INVITE || process.env.WHATSAPP_INVITE_CODE,
    );

    if (inviteCode) {
      try {
        const info = await client.getInviteInfo(inviteCode);
        const rawId =
          info?.id?._serialized ||
          info?.id ||
          info?.groupId?._serialized ||
          info?.groupId ||
          info?.gid?._serialized ||
          info?.gid ||
          null;
        const id = normalizeGroupId(rawId);
        if (id) {
          groupResolver.setId(id);
          const subject = info?.subject || info?.name || WHATSAPP_GROUP_NAME;
          console.log(
            `[whatsapp-bot] Resolved group from invite "${subject}" → ${id}`,
          );
          return id;
        }
        console.warn(
          '[whatsapp-bot] getInviteInfo returned no usable id:',
          JSON.stringify(info).slice(0, 400),
        );
      } catch (err) {
        console.warn(
          '[whatsapp-bot] getInviteInfo failed:',
          err?.message || err,
        );
      }
    }

    // Optional legacy path — often broken (`r: r`) on current WhatsApp Web.
    if (process.env.WHATSAPP_USE_GET_CHATS === 'true') {
      try {
        const wanted = WHATSAPP_GROUP_NAME.trim().toLowerCase();
        const chats = await client.getChats();
        const match = chats.find(
          (chat) =>
            chat.isGroup && (chat.name || '').trim().toLowerCase() === wanted,
        );
        if (match) {
          const id = match.id._serialized;
          groupResolver.setId(id);
          console.log(
            `[whatsapp-bot] Resolved group "${match.name}" → ${id}`,
          );
          return id;
        }
        console.warn(
          `[whatsapp-bot] Group "${WHATSAPP_GROUP_NAME}" not found via getChats().`,
        );
      } catch (err) {
        console.warn(
          '[whatsapp-bot] getChats failed (expected on some WA Web builds):',
          err?.message || err,
        );
      }
    }

    console.warn(
      '[whatsapp-bot] Group id not resolved yet. Set WHATSAPP_GROUP_ID=…@g.us or WHATSAPP_GROUP_INVITE=https://chat.whatsapp.com/… — or send any message in the group to auto-learn the id.',
    );
    return null;
  } catch (err) {
    console.warn(
      '[whatsapp-bot] resolveTargetGroupId unexpected error:',
      err?.message || err,
    );
    return null;
  }
}

/**
 * Best-effort LID ↔ phone enrichment via WhatsApp contacts store.
 * Only works when the person is in the bot account's contacts / open 1:1 chat.
 * @param {string | null | undefined} jid
 * @returns {Promise<{ lid: string | null, phone: string | null, name: string | null }>}
 */
async function enrichSenderFromWhatsapp(jid) {
  const empty = { lid: null, phone: null, name: null };
  if (!jid || typeof client.getContactLidAndPhone !== 'function') return empty;

  try {
    const rows = await client.getContactLidAndPhone([jid]);
    const row = Array.isArray(rows) ? rows[0] : null;
    const lid = row?.lid
      ? String(row.lid).split('@')[0].replace(/\D/g, '') || null
      : null;
    const phone = row?.pn
      ? String(row.pn).split('@')[0].replace(/\D/g, '') || null
      : null;

    let name = null;
    try {
      const contact = await client.getContactById(jid);
      name = contact?.pushname || contact?.name || contact?.shortName || null;
    } catch {
      // ignore — getContact is flaky on some WA Web builds
    }

    if (lid || phone) {
      console.log(
        `[whatsapp-bot] Enriched ${jid} → lid=${lid ?? 'n/a'} phone=${phone ?? 'n/a'} name=${name ?? 'n/a'}`,
      );
    }
    return { lid, phone, name };
  } catch (err) {
    console.warn(
      '[whatsapp-bot] getContactLidAndPhone failed:',
      err?.message || err,
    );
    return empty;
  }
}

/**
 * Map common RSVP reaction emojis without calling Grok.
 * @param {string | null | undefined} emoji
 * @returns {Intent | null}
 */
function intentFromReactionEmoji(emoji) {
  if (!emoji) return null;
  if (POSITIVE_REACTION_IDS.has(emoji)) return 'RSVP_YES';
  if (NEGATIVE_REACTION_IDS.has(emoji)) return 'RSVP_NO';
  return null;
}

// ─────────────────────────── Client bootstrap ───────────────────────────

const AUTH_DATA_PATH =
  process.env.WHATSAPP_AUTH_PATH || path.resolve(__dirname, '.wwebjs_auth');
const WHATSAPP_CLIENT_ID =
  process.env.WHATSAPP_CLIENT_ID || 'mkeplays-tennis-bot';

/**
 * After a Railway redeploy, Chromium leaves SingletonLock files on the volume
 * that reference the old container hostname. Clear them before launch so the
 * new process can open the same LocalAuth profile without Code 21.
 * @param {string} rootDir
 */
function clearStaleChromiumLocks(rootDir) {
  const lockNames = new Set([
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
    'lockfile',
  ]);

  if (!fs.existsSync(rootDir)) return;

  /** @type {string[]} */
  const removed = [];
  /** @type {string[]} */
  const stack = [rootDir];

  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (
        lockNames.has(entry.name) ||
        entry.name.startsWith('Singleton') ||
        entry.name === 'DevToolsActivePort'
      ) {
        try {
          fs.rmSync(full, { force: true });
          removed.push(full);
        } catch (err) {
          console.warn(
            `[whatsapp-bot] Could not remove lock ${full}: ${err.message}`,
          );
        }
      }
    }
  }

  if (removed.length) {
    console.log(
      `[whatsapp-bot] Cleared ${removed.length} stale Chromium lock file(s) under ${rootDir}`,
    );
  }
}

clearStaleChromiumLocks(AUTH_DATA_PATH);

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: WHATSAPP_CLIENT_ID,
    dataPath: AUTH_DATA_PATH,
  }),
  puppeteer: {
    headless: true,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      process.env.CHROMIUM_PATH ||
      undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
    ],
  },
});

client.on('qr', (qr) => {
  console.log('\n[whatsapp-bot] Scan this QR with WhatsApp → Linked Devices:\n');
  qrcode.generate(qr, { small: true });
  // Railway logs rarely render ASCII QR well — open this URL on your phone:
  console.log(
    `[whatsapp-bot] Or open: https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}\n`,
  );
});

client.on('authenticated', () => {
  console.log('[whatsapp-bot] Authenticated (LocalAuth session saved).');
});

client.on('auth_failure', (msg) => {
  console.error('[whatsapp-bot] Auth failure:', msg);
});

client.on('ready', async () => {
  console.log(
    `[whatsapp-bot] Ready. Listening for messages in group "${WHATSAPP_GROUP_NAME}".`,
  );
  const pinned = groupResolver.getId();
  if (pinned) {
    console.log(`[whatsapp-bot] Using WHATSAPP_GROUP_ID=${pinned}`);
    return;
  }
  try {
    await resolveTargetGroupId();
  } catch (err) {
    console.warn(
      '[whatsapp-bot] Startup group resolve failed (will auto-learn from first group message):',
      err?.message || err,
    );
  }
});

client.on('disconnected', (reason) => {
  console.warn('[whatsapp-bot] Disconnected:', reason);
});

client.on('message', async (message) => {
  try {
    const decision = groupResolver.shouldProcessMessage({
      from: message.from,
      fromMe: message.fromMe,
      processSelf: process.env.WHATSAPP_PROCESS_SELF === 'true',
    });
    if (!decision.ok) return;

    // In groups, author is the participant; avoid flaky getContact()/getChat().
    // Modern WhatsApp may use @lid (not a real phone) — enrich when contacts allow.
    const identity = extractSenderIdentity(message);
    const whatsappMessageId = serializeWhatsappMessageId(message);

    if (!identity.senderKey && !identity.senderJid) {
      console.warn('[whatsapp-bot] Skipping message with unknown sender id.', {
        author: message.author,
        from: message.from,
      });
      return;
    }
    if (!whatsappMessageId) {
      console.warn('[whatsapp-bot] Skipping message with unknown message id.', {
        id: message.id,
      });
      return;
    }

    const enriched = await enrichSenderFromWhatsapp(identity.senderJid);
    const senderLid =
      enriched.lid ||
      (identity.isLid ? identity.senderKey : null) ||
      (identity.senderJid?.includes('@lid')
        ? String(identity.senderJid).split('@')[0].replace(/\D/g, '') || null
        : null);
    const senderPhone =
      enriched.phone || (identity.isLid ? null : identity.senderKey) || null;
    const senderName = enriched.name || null;

    if (!senderPhone && !senderLid) {
      console.warn('[whatsapp-bot] Skipping message — no phone or LID.', {
        author: message.author,
        from: message.from,
      });
      return;
    }

    /** @type {AnalyzePayload} */
    const payload = {
      kind: 'message',
      text: message.body || null,
      reaction: null,
      senderPhone: senderPhone || '',
      senderLid,
      senderJid: identity.senderJid,
      senderName,
      whatsappMessageId,
      targetMessageId: null,
    };

    console.log(
      `[whatsapp-bot] Message lid=${senderLid ?? 'n/a'} phone=${senderPhone ?? 'n/a'}: ${(payload.text || '').slice(0, 120)}`,
    );

    const analysis = await analyzeWithxAI(payload);
    await dispatchIntent(payload, analysis);
  } catch (err) {
    console.error('[whatsapp-bot] message handler error:', err);
  }
});

client.on('message_reaction', async (reaction) => {
  try {
    const emoji = reaction.reaction || reaction.emoji || null;
    // Empty reaction string usually means the reaction was removed.
    if (!emoji) {
      console.log('[whatsapp-bot] Reaction removed; ignoring.');
      return;
    }

    const msgId = reaction.msgId;
    // msgId may be a MessageId object or serialized string depending on version.
    const targetMessageId =
      typeof msgId === 'string'
        ? msgId
        : msgId?._serialized ||
          (msgId?.remote && msgId?.id
            ? `${msgId.fromMe ? 'true' : 'false'}_${msgId.remote}_${msgId.id}`
            : null);

    if (!targetMessageId) {
      console.warn('[whatsapp-bot] Reaction without resolvable target message id.');
      return;
    }

    // Prefer chat id from the reaction's message id (no Puppeteer getChat).
    const reactionChatId =
      (typeof msgId === 'object' && msgId?.remote) ||
      (typeof targetMessageId === 'string' && targetMessageId.includes('@g.us')
        ? targetMessageId.split('_').find((part) => part.endsWith('@g.us'))
        : null);

    if (!groupResolver.getId()) {
      try {
        await resolveTargetGroupId();
      } catch {
        // ignore
      }
    }

    if (reactionChatId && !groupResolver.isTargetGroupId(reactionChatId)) return;
    if (
      !reactionChatId &&
      process.env.WHATSAPP_REQUIRE_GROUP_ON_REACTION === 'true'
    ) {
      console.warn('[whatsapp-bot] Skipping reaction; group chat unresolved.');
      return;
    }
    if (!reactionChatId && groupResolver.getId()) {
      console.warn(
        '[whatsapp-bot] Reaction chat id unknown; processing anyway (set WHATSAPP_REQUIRE_GROUP_ON_REACTION=true to strict-filter).',
      );
    }

    const reactorJid = String(reaction.senderId || reaction.id || '');
    const reactorIsLid = reactorJid.includes('@lid');
    const reactorKey = reactorJid
      .split('@')[0]
      .replace(/:\d+$/, '')
      .replace(/\D/g, '');

    const enriched = await enrichSenderFromWhatsapp(reactorJid || null);
    const senderLid =
      enriched.lid || (reactorIsLid ? reactorKey || null : null);
    const senderPhone =
      enriched.phone || (reactorIsLid ? null : reactorKey || null);
    const senderName = enriched.name || null;

    if (!senderPhone && !senderLid) {
      console.warn('[whatsapp-bot] Skipping reaction with unknown reactor id.');
      return;
    }

    /** @type {AnalyzePayload} */
    const payload = {
      kind: 'reaction',
      text: null,
      reaction: emoji,
      senderPhone: senderPhone || '',
      senderLid,
      senderJid: reactorJid || null,
      senderName,
      whatsappMessageId: targetMessageId,
      targetMessageId,
    };

    // Thumbs-up / tennis-ball (and similar) short-circuit to RSVP without Grok.
    const shortcut = intentFromReactionEmoji(emoji);
    if (shortcut) {
      console.log(
        `[whatsapp-bot] Reaction shortcut ${emoji} → ${shortcut} lid=${senderLid ?? 'n/a'} phone=${senderPhone ?? 'n/a'}`,
      );
      await dispatchIntent(payload, {
        intent: shortcut,
        confidence: 1,
        extractedData: { title: null, suggestedTime: null, venue: null },
      });
      return;
    }

    const analysis = await analyzeWithxAI(payload);
    await dispatchIntent(payload, analysis);
  } catch (err) {
    console.error('[whatsapp-bot] message_reaction handler error:', err);
  }
});

client.initialize().catch((err) => {
  console.error('[whatsapp-bot] Failed to initialize client:', err);
  process.exit(1);
});

async function gracefulShutdown(signal) {
  console.log(`\n[whatsapp-bot] ${signal} — shutting down…`);
  try {
    await client.destroy();
  } catch {
    // ignore
  }
  // Extra safety for volume-backed profiles on Railway.
  clearStaleChromiumLocks(AUTH_DATA_PATH);
  process.exit(0);
}

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});
