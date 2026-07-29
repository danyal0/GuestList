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

function loadVenuesCatalog() {
  const candidates = [
    path.resolve(__dirname, '../../apps/api/src/data/venues-catalog.json'),
    path.resolve(__dirname, '../../apps/api/data/venues-catalog.json'),
    path.resolve(process.cwd(), 'apps/api/src/data/venues-catalog.json'),
    path.resolve(process.cwd(), 'apps/api/data/venues-catalog.json'),
    path.resolve(process.cwd(), 'src/data/venues-catalog.json'),
    path.resolve(process.cwd(), 'data/venues-catalog.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      // continue
    }
  }
  return [];
}

const VENUES_CATALOG = loadVenuesCatalog();

function catalogPromptBlock() {
  if (!VENUES_CATALOG.length) return '(no local catalog loaded)';
  return VENUES_CATALOG.map((v) => {
    const courts =
      typeof v.courtCount === 'number' ? ` courts=${v.courtCount}` : '';
    const cap =
      typeof v.defaultCapacity === 'number'
        ? ` defaultCapacity=${v.defaultCapacity}`
        : '';
    return `- slug=${v.slug} name="${v.name}" address="${v.address}" aliases=[${(v.aliases || []).join(', ')}] lat=${v.latitude} lng=${v.longitude}${courts}${cap}`;
  }).join('\n');
}

function resolveCatalogFromClue(clue) {
  if (!clue) return null;
  const hay = String(clue).toLowerCase().replace(/\s+/g, ' ').trim();
  let best = null;
  for (const venue of VENUES_CATALOG) {
    for (const alias of venue.aliases || []) {
      if (alias.length < 4) continue;
      if (hay.includes(alias)) {
        const score = alias.length;
        if (!best || score > best.score) best = { venue, score, matchedAlias: alias };
      }
    }
    if (hay.includes(String(venue.name).toLowerCase())) {
      const score = String(venue.name).length + 5;
      if (!best || score > best.score) best = { venue, score, matchedAlias: venue.name };
    }
  }
  return best;
}

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
 *     venueSlug: string | null,
 *     instructions: string | null,
 *     notes: string | null,
 *     skillLevel: string | null,
 *     courtInfo: string | null,
 *     durationMinutes: number | null,
 *     capacity: number | null,
 *     capacityConfidence: number | null,
 *     namedAttendees: string[] | null,
 *     isReschedule: boolean | null,
 *     rescheduleConfidence: number | null,
 *     isCancel: boolean | null,
 *     cancelConfidence: number | null,
 *     timezone: string | null,
 *     venueConfidence: number | null,
 *     addressConfidence: number | null,
 *     timeConfidence: number | null,
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
 *   quotedText?: string | null,
 *   targetEventId?: string | null,
 * }} AnalyzePayload
 */

const SYSTEM_PROMPT = `You are a STRICT extractor for MKE Plays (Milwaukee tennis WhatsApp → events).
Do NOT invent places, addresses, or instructions that are not supported by the message or the VERIFIED catalog below.

Identify exactly one intent: CREATE_EVENT | RSVP_YES | RSVP_NO | IGNORE.
CREATE_EVENT also covers reschedules AND cancellations of an existing match (still CREATE_EVENT; set isReschedule/isCancel + confidence).
If quotedText is present, this message is a WhatsApp reply — prefer updating/cancelling that prior invite over creating a new event.

WORD-LEVEL ANALYSIS (mandatory for CREATE_EVENT):
Break the message into tokens/phrases and assign each a role when possible:
- person name (who is going / playing besides the sender) — "Khatera and I" → namedAttendees=["Khatera"]
- time / day cue ("about 6 pm")
- place / venue cue ("Atwater Elementary School in Shorewood")
- reschedule cue ("earlier than planned", "later than planned", "moved to", "new time", "instead of") → isReschedule=true
- cancel cue ("cancelled", "canceled", "cancel", "called off", "not happening", "rain out") → isCancel=true (CANCEL BEATS CREATE even if time/venue are restated)
- capacity cue (singles=2, doubles=4, "need 3", "4 people", N courts → N×4)
- skill / format / court info
- maps links (maps.app.goo.gl / google maps) — keep in notes if useful; do not invent coordinates from them
Ignore filler (hi, lol, please). Every meaningful word should inform a field or confidence.

VERIFIED Milwaukee tennis venues (ONLY use these for precise address/lat/lng unless the message itself contains a full street address with numbers). Each lists courts + defaultCapacity (courts×4 for open play):
${catalogPromptBlock()}

Critical local rules:
- For TENNIS, casual "lake front" / "lakefront" means McKinley Tennis Courts (slug=mckinley-tennis-courts), NOT Lake Park.
- "lake park" / Bradford / Kenwood → Lake Park Tennis Courts only when those words appear.
- "atwater" / Shorewood Atwater → Atwater Elementary School courts (slug=atwater-elementary-tennis).
- Timezone America/Chicago. Bare hours 1–8 without am/pm → prefer PM for tennis (6 → 6pm). Morning only if explicit.
- suggestedTime: ISO-8601 with Chicago offset when possible.
- capacity: prefer explicit party size from the message; else singles/doubles; else venue defaultCapacity from catalog. Set capacityConfidence honestly.
- namedAttendees: first names of people the message says are going/playing (e.g. "Khatera and I are going" → ["Khatera"]). Do NOT include the sender.
- isReschedule / rescheduleConfidence: set high when the host is changing a prior plan ("earlier than planned" is a strong clue). The API will update the existing event and notify RSVPs.
- isCancel / cancelConfidence: set high when the host is calling off a prior plan. Do NOT create a new event for a cancel message. Prefer CREATE_EVENT+isCancel over IGNORE when cancel words are present.

Strictness:
- Set venueConfidence / addressConfidence / timeConfidence / capacityConfidence / rescheduleConfidence / cancelConfidence from 0–1 honestly.
- If you cannot map to a catalog slug confidently, leave address/lat/lng null and set venueConfidence < 0.7.
- instructions/notes/skillLevel/courtInfo: ONLY if present or strongly implied in the message. Do NOT invent meetup fluff.
- title may be a short paraphrase of the ask.

Return ONLY minified JSON:
{"intent":"CREATE_EVENT"|"RSVP_YES"|"RSVP_NO"|"IGNORE","confidence":0.0,"extractedData":{"title":null,"suggestedTime":null,"venue":null,"locationName":null,"address":null,"latitude":null,"longitude":null,"venueSlug":null,"instructions":null,"notes":null,"skillLevel":null,"courtInfo":null,"durationMinutes":null,"capacity":null,"capacityConfidence":0.0,"namedAttendees":[],"isReschedule":false,"rescheduleConfidence":0.0,"isCancel":false,"cancelConfidence":0.0,"timezone":"America/Chicago","venueConfidence":0.0,"addressConfidence":0.0,"timeConfidence":0.0}}`;

const REFINE_VENUE_PROMPT = `You refine ONLY venue/address for a Milwaukee tennis WhatsApp message.
Use the VERIFIED catalog. For tennis, "lake front"/"lakefront" = McKinley Tennis Courts.
If still unsure, return nulls and low confidence — never invent an address.
Catalog:
${catalogPromptBlock()}

Return ONLY JSON:
{"venueSlug":null,"locationName":null,"address":null,"latitude":null,"longitude":null,"venueConfidence":0.0,"addressConfidence":0.0,"rationale":""}`;

const MIN_FIELD_CONFIDENCE = Number(process.env.WHATSAPP_MIN_FIELD_CONFIDENCE || '0.8');
const MAX_AI_REFINES = Number(process.env.WHATSAPP_MAX_AI_REFINES || '2');

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
    quotedText: payload.quotedText ?? null,
    isReply: Boolean(payload.targetMessageId),
    nowAmericaChicago: nowChi,
    locale: 'Milwaukee, WI',
    hint:
      payload.kind === 'reaction'
        ? 'WhatsApp reaction on a prior message that may be a match invitation.'
        : payload.targetMessageId
          ? 'WhatsApp reply to a prior tennis invite. Prefer cancel/reschedule of that invite over creating a new event. lake front → McKinley. Bare hour → PM.'
          : 'WhatsApp tennis message in Milwaukee. Be strict. lake front → McKinley. Bare hour → PM. Cancel words → isCancel (do not create).',
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

  let analysis = parseAnalysisJson(rawContent);
  const localCancelEarly = detectCancelCuesLocal(payload.text);
  const isCancel =
    localCancelEarly.matched ||
    Boolean(analysis.extractedData?.isCancel) ||
    (typeof analysis.extractedData?.cancelConfidence === 'number' &&
      analysis.extractedData.cancelConfidence >= 0.7);
  // Cancel-only messages must not invent a venue (that breaks soft-matching
  // app-created events that aren't at McKinley / catalog defaults).
  if (analysis.intent === 'CREATE_EVENT' && !isCancel) {
    analysis = await ensureVenueConfidence(payload, analysis);
  } else if (isCancel) {
    analysis.extractedData.isCancel = true;
    analysis.extractedData.cancelConfidence = Math.max(
      localCancelEarly.confidence,
      typeof analysis.extractedData.cancelConfidence === 'number'
        ? analysis.extractedData.cancelConfidence
        : 0,
      0.9,
    );
    analysis.extractedData.venueSlug = null;
    analysis.extractedData.venue = null;
    analysis.extractedData.locationName = null;
    analysis.extractedData.address = null;
    analysis.extractedData.latitude = null;
    analysis.extractedData.longitude = null;
    analysis.extractedData.venueConfidence = 0;
    analysis.extractedData.addressConfidence = 0;
    analysis.extractedData.capacity = null;
  }
  return analysis;
}

/**
 * Local catalog first; if still weak, ask Grok again (up to MAX_AI_REFINES).
 * @param {AnalyzePayload} payload
 * @param {AnalysisResult} analysis
 * @returns {Promise<AnalysisResult>}
 */
async function ensureVenueConfidence(payload, analysis) {
  const x = analysis.extractedData;
  const clue = [payload.text, x.venue, x.locationName, x.venueSlug, x.address]
    .filter(Boolean)
    .join(' ');
  const local = resolveCatalogFromClue(clue);
  if (local) {
    x.venueSlug = local.venue.slug;
    x.locationName = local.venue.name;
    x.address = local.venue.address;
    x.latitude = local.venue.latitude;
    x.longitude = local.venue.longitude;
    x.venue = local.venue.name;
    x.venueConfidence = 1;
    x.addressConfidence = 1;
    console.log(
      `[whatsapp-bot] Catalog venue match alias="${local.matchedAlias}" → ${local.venue.slug}`,
    );
    return analysis;
  }

  for (let attempt = 1; attempt <= MAX_AI_REFINES; attempt += 1) {
    const venueOk =
      (x.venueConfidence ?? 0) >= MIN_FIELD_CONFIDENCE &&
      Boolean(x.venueSlug || (x.address && /\d/.test(x.address)));
    const addressOk =
      (x.addressConfidence ?? 0) >= MIN_FIELD_CONFIDENCE &&
      Boolean(x.address && /\d/.test(x.address));
    if (venueOk && addressOk) break;

    console.log(
      `[whatsapp-bot] Venue/address confidence low (v=${x.venueConfidence} a=${x.addressConfidence}) — refine #${attempt}`,
    );
    const refined = await refineVenueWithxAI(payload, analysis);
    if (!refined) break;
    if (refined.venueSlug) x.venueSlug = refined.venueSlug;
    if (refined.locationName) x.locationName = refined.locationName;
    if (refined.address) x.address = refined.address;
    if (refined.latitude != null) x.latitude = refined.latitude;
    if (refined.longitude != null) x.longitude = refined.longitude;
    if (refined.venueConfidence != null) x.venueConfidence = refined.venueConfidence;
    if (refined.addressConfidence != null) {
      x.addressConfidence = refined.addressConfidence;
    }

    const again = resolveCatalogFromClue(
      [payload.text, x.venueSlug, x.locationName, x.address].filter(Boolean).join(' '),
    );
    if (again) {
      x.venueSlug = again.venue.slug;
      x.locationName = again.venue.name;
      x.address = again.venue.address;
      x.latitude = again.venue.latitude;
      x.longitude = again.venue.longitude;
      x.venueConfidence = 1;
      x.addressConfidence = 1;
      console.log(
        `[whatsapp-bot] Catalog match after refine → ${again.venue.slug}`,
      );
      break;
    }
  }

  return analysis;
}

/**
 * @param {AnalyzePayload} payload
 * @param {AnalysisResult} prior
 */
async function refineVenueWithxAI(payload, prior) {
  const userContent = JSON.stringify({
    message: payload.text,
    priorExtract: {
      venue: prior.extractedData.venue,
      locationName: prior.extractedData.locationName,
      venueSlug: prior.extractedData.venueSlug,
      address: prior.extractedData.address,
      venueConfidence: prior.extractedData.venueConfidence,
      addressConfidence: prior.extractedData.addressConfidence,
    },
    reminder:
      'lake front tennis in Milwaukee = McKinley Tennis Courts. Do not invent addresses.',
  });

  try {
    const response = await fetch(XAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: XAI_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: REFINE_VENUE_PROMPT },
          { role: 'user', content: userContent },
        ],
      }),
    });
    if (!response.ok) {
      console.warn(`[whatsapp-bot] refine HTTP ${response.status}`);
      return null;
    }
    const data = await response.json();
    const raw =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.text ??
      '';
    const cleaned = String(raw)
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    return {
      venueSlug: nullableString(parsed.venueSlug),
      locationName: nullableString(parsed.locationName),
      address: nullableString(parsed.address),
      latitude: nullableNumber(parsed.latitude),
      longitude: nullableNumber(parsed.longitude),
      venueConfidence: clampConfidence(parsed.venueConfidence),
      addressConfidence: clampConfidence(parsed.addressConfidence),
      rationale: nullableString(parsed.rationale),
    };
  } catch (err) {
    console.warn('[whatsapp-bot] refine failed:', err?.message || err);
    return null;
  }
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
        capacity: nullableNumber(extracted.capacity),
        capacityConfidence: nullableNumber(extracted.capacityConfidence),
        namedAttendees: nullableStringArray(extracted.namedAttendees),
        isReschedule: Boolean(extracted.isReschedule),
        rescheduleConfidence: nullableNumber(extracted.rescheduleConfidence),
        isCancel: Boolean(extracted.isCancel),
        cancelConfidence: nullableNumber(extracted.cancelConfidence),
        timezone: nullableString(extracted.timezone) || 'America/Chicago',
        venueSlug: nullableString(extracted.venueSlug),
        venueConfidence: nullableNumber(extracted.venueConfidence),
        addressConfidence: nullableNumber(extracted.addressConfidence),
        timeConfidence: nullableNumber(extracted.timeConfidence),
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

/** @param {unknown} value @returns {string[]} */
function nullableStringArray(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const s = nullableString(item);
    if (!s) continue;
    if (out.some((o) => o.toLowerCase() === s.toLowerCase())) continue;
    out.push(s);
  }
  return out;
}

/** Local fallback: names said to be going/playing in the message. */
function extractNamedAttendeesFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const stop = new Set([
    'i',
    'im',
    'me',
    'we',
    'us',
    'you',
    'he',
    'she',
    'they',
    'anyone',
    'someone',
    'tomorrow',
    'today',
    'tonight',
    'tennis',
    'court',
    'courts',
    'park',
    'lake',
    'front',
    'doubles',
    'singles',
    'lets',
    'please',
    'also',
    'going',
    'need',
    'pm',
    'am',
    'play',
    'playing',
    'elementary',
    'school',
    'shorewood',
    'everyone',
    'welcome',
  ]);
  const found = [];
  const push = (raw) => {
    if (!raw) return;
    const name = String(raw).replace(/[^A-Za-zÀ-ÿ'’-]/g, '').trim();
    if (name.length < 2 || name.length > 40) return;
    const key = name.toLowerCase();
    if (stop.has(key) || found.some((f) => f.toLowerCase() === key)) return;
    found.push(name.charAt(0).toUpperCase() + name.slice(1));
  };
  const patterns = [
    /\b([A-Za-zÀ-ÿ'’-]{2,40})\s+is\s+(?:also\s+)?(?:going|in|down|coming|joining|playing)\b/gi,
    /\b(?:also)\s+([A-Za-zÀ-ÿ'’-]{2,40})\s+(?:is\s+)?(?:going|in|down|coming|joining)\b/gi,
    /\b(?:with|plus|\+)\s+([A-Za-zÀ-ÿ'’-]{2,40})\b/gi,
    /\bme\s+and\s+([A-Za-zÀ-ÿ'’-]{2,40})\b/gi,
    /\b([A-Za-zÀ-ÿ'’-]{2,40})\s+and\s+(?:me|i)\b/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) push(m[1]);
  }
  return found;
}

function detectRescheduleCuesLocal(text) {
  if (!text) return { matched: false, confidence: 0 };
  const patterns = [
    /\bearlier\s+than\s+planned\b/i,
    /\blater\s+than\s+planned\b/i,
    /\b(?:reschedul(?:e|ed|ing)|time\s+change|changed\s+(?:the\s+)?time)\b/i,
    /\b(?:pushed|moved|shifted)\s+(?:it\s+)?(?:up|earlier|back|later)\b/i,
    /\bnew\s+time\b/i,
    /\bmoving\s+(?:to|it\s+to)\b/i,
  ];
  for (const re of patterns) {
    if (re.test(text)) return { matched: true, confidence: 0.95 };
  }
  return { matched: false, confidence: 0 };
}

function detectCancelCuesLocal(text) {
  if (!text) return { matched: false, confidence: 0 };
  const patterns = [
    /\b(?:is\s+)?cancell?ed\b/i,
    /\bcancell?ing\b/i,
    /\bcancel\b/i,
    /\bcalled\s+off\b/i,
    /\bcall\s+it\s+off\b/i,
    /\bnot\s+happening\b/i,
    /\bno\s+longer\s+happening\b/i,
    /\brain(?:ed)?\s*out\b/i,
    /\bwon'?t\s+(?:be\s+)?(?:happening|playing|making\s+it)\b/i,
    /\bscrap(?:ping|ped)?\s+(?:the\s+)?(?:game|match|plan|session)\b/i,
  ];
  for (const re of patterns) {
    if (re.test(text)) return { matched: true, confidence: 0.95 };
  }
  return { matched: false, confidence: 0 };
}

/**
 * Resolve the WhatsApp message this one replies to (quoted/referenced).
 * Prefer getQuotedMessage(); fall back to embedded `_data.quotedMsg` when Store APIs fail.
 * @param {any} message
 * @returns {Promise<{ id: string | null, text: string | null }>}
 */
async function resolveQuotedMessage(message) {
  const fromData = extractQuotedFromRawData(message);
  if (!message?.hasQuotedMsg && !fromData.text && !fromData.id) {
    return { id: null, text: null };
  }

  try {
    if (message?.hasQuotedMsg && typeof message.getQuotedMessage === 'function') {
      const quoted = await message.getQuotedMessage();
      if (quoted) {
        return {
          id: serializeWhatsappMessageId(quoted) || fromData.id,
          text:
            (typeof quoted.body === 'string' && quoted.body.trim()
              ? quoted.body
              : null) || fromData.text,
        };
      }
    }
  } catch (err) {
    const detail =
      err && typeof err === 'object'
        ? err.message || err.stack || JSON.stringify(err).slice(0, 200)
        : String(err);
    console.warn(
      `[whatsapp-bot] getQuotedMessage failed (${detail}) — using embedded quote data`,
    );
  }

  if (fromData.id || fromData.text) {
    console.log(
      `[whatsapp-bot] Quoted fallback id=${fromData.id ?? 'n/a'} text=${(fromData.text || '').slice(0, 80)}`,
    );
  }
  return fromData;
}

/**
 * Pull quote id/body from the inbound message model without Store lookups.
 * @param {any} message
 * @returns {{ id: string | null, text: string | null }}
 */
function extractQuotedFromRawData(message) {
  const data = message?._data || message?.rawData || {};
  const quoted = data.quotedMsg || data.quotedMsgObj || null;
  const text =
    (typeof quoted?.body === 'string' && quoted.body.trim()
      ? quoted.body
      : null) ||
    (typeof quoted?.caption === 'string' && quoted.caption.trim()
      ? quoted.caption
      : null) ||
    null;

  let id = null;
  const stanza =
    data.quotedStanzaID ||
    data.quotedId ||
    quoted?.id?.id ||
    quoted?.id?._serialized ||
    (typeof quoted?.id === 'string' ? quoted.id : null);
  if (stanza && typeof stanza === 'string' && stanza.includes('_')) {
    id = stanza;
  } else if (stanza) {
    const chatId =
      message?.from ||
      data.from ||
      message?.id?.remote ||
      data.to ||
      null;
    const participant = data.quotedParticipant || quoted?.author || null;
    const fromMe =
      data.quotedMsg?.fromMe === true ||
      (participant &&
        message?.author &&
        String(participant) === String(message.author));
    if (chatId) {
      // Group replies usually serialize as false_<group>_<stanza>
      id = `${fromMe ? 'true' : 'false'}_${chatId}_${stanza}`;
    }
  }

  return { id, text };
}

/** @param {string | null | undefined} text */
function extractAppEventIdFromText(text) {
  if (!text) return null;
  const m = String(text).match(
    /\/events\/([a-zA-Z0-9_-]{6,})\b/,
  );
  return m?.[1] || null;
}

/** Infer capacity when AI omits it, using venue catalog defaults. */
function inferCapacityLocal(extracted, messageText) {
  if (typeof extracted.capacity === 'number' && extracted.capacity >= 1) {
    return extracted.capacity;
  }
  const text = `${extracted.courtInfo || ''} ${messageText || ''}`.toLowerCase();
  const explicit =
    text.match(
      /\b(?:need|for|max|capacity|spots?(?:\s*(?:for|left|open))?|only)\s+(\d{1,3})\b/,
    ) ||
    text.match(/\b(\d{1,3})\s*(?:spots?|players?|people|ppl)\b/);
  if (explicit?.[1]) {
    const n = Number(explicit[1]);
    if (n >= 1 && n <= 1000) return n;
  }
  const courts = text.match(/\b(\d{1,2})\s*courts?\b/);
  if (courts?.[1]) {
    const n = Number(courts[1]);
    if (n >= 1 && n <= 40) return n * 4;
  }
  if (/\bsingles?\b/.test(text)) return 2;
  if (/\bdoubles?\b/.test(text)) return 4;

  const clue = [extracted.venueSlug, extracted.locationName, extracted.venue, messageText]
    .filter(Boolean)
    .join(' ');
  const match = resolveCatalogFromClue(clue);
  if (match?.venue) {
    if (typeof match.venue.defaultCapacity === 'number') {
      return match.venue.defaultCapacity;
    }
    if (typeof match.venue.courtCount === 'number') {
      return match.venue.courtCount * 4;
    }
  }
  return null;
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
      capacity: null,
      capacityConfidence: null,
      namedAttendees: [],
      isReschedule: false,
      rescheduleConfidence: null,
      isCancel: false,
      cancelConfidence: null,
      timezone: 'America/Chicago',
      venueSlug: null,
      venueConfidence: null,
      addressConfidence: null,
      timeConfidence: null,
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
      const code = json && typeof json === 'object' ? json.code || json.error : null;
      const message =
        json && typeof json === 'object' ? json.message || json.error : null;
      if (res.status === 422) {
        console.warn(
          `[whatsapp-bot] CREATE_EVENT rejected (${code ?? 'validation'}): ${message ?? text.slice(0, 200)}`,
          Array.isArray(json?.hints) ? `hints=${JSON.stringify(json.hints)}` : '',
        );
      } else {
        console.error(
          `[whatsapp-bot] POST ${path} → ${res.status}`,
          json ?? text.slice(0, 400),
        );
      }
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
  const localCancel = detectCancelCuesLocal(payload.text);
  const localReschedule = detectRescheduleCuesLocal(payload.text);
  const clearCancel =
    localCancel.matched ||
    Boolean(analysis.extractedData?.isCancel) ||
    (typeof analysis.extractedData?.cancelConfidence === 'number' &&
      analysis.extractedData.cancelConfidence >= 0.7);
  const clearReschedule =
    localReschedule.matched ||
    Boolean(analysis.extractedData?.isReschedule) ||
    (typeof analysis.extractedData?.rescheduleConfidence === 'number' &&
      analysis.extractedData.rescheduleConfidence >= 0.7);
  const replyTarget = Boolean(payload.targetMessageId);

  // Cancel / clear reschedule should not die on low AI confidence.
  // Replies only bypass when cancel/reschedule cues exist, or AI already chose CREATE_EVENT.
  const shouldBypassConfidence =
    clearCancel ||
    clearReschedule ||
    (replyTarget &&
      (clearCancel ||
        clearReschedule ||
        analysis.intent === 'CREATE_EVENT'));

  if (
    (analysis.intent === 'IGNORE' || analysis.confidence < MIN_CONFIDENCE) &&
    shouldBypassConfidence
  ) {
    console.log(
      `[whatsapp-bot] Overriding low-confidence/IGNORE → CREATE_EVENT (cancel=${clearCancel} reschedule=${clearReschedule} reply=${replyTarget} ai=${analysis.intent}/${analysis.confidence})`,
    );
    analysis = {
      ...analysis,
      intent: 'CREATE_EVENT',
      confidence: Math.max(analysis.confidence, 0.9),
      extractedData: {
        ...analysis.extractedData,
        isCancel: clearCancel || analysis.extractedData.isCancel,
        cancelConfidence: Math.max(
          localCancel.confidence,
          typeof analysis.extractedData.cancelConfidence === 'number'
            ? analysis.extractedData.cancelConfidence
            : 0,
          clearCancel ? 0.9 : 0,
        ),
        isReschedule:
          !clearCancel &&
          (clearReschedule || analysis.extractedData.isReschedule || replyTarget),
        rescheduleConfidence: clearCancel
          ? 0
          : Math.max(
              localReschedule.confidence,
              typeof analysis.extractedData.rescheduleConfidence === 'number'
                ? analysis.extractedData.rescheduleConfidence
                : 0,
              clearReschedule || replyTarget ? 0.85 : 0,
            ),
      },
    };
  }

  if (analysis.intent === 'IGNORE' || analysis.confidence < MIN_CONFIDENCE) {
    console.log(
      `[whatsapp-bot] Ignoring (intent=${analysis.intent}, confidence=${analysis.confidence})`,
    );
    return;
  }

  if (analysis.intent === 'CREATE_EVENT') {
    const x = analysis.extractedData;
    const localNames = extractNamedAttendeesFromText(payload.text);
    const namedAttendees = [
      ...(Array.isArray(x.namedAttendees) ? x.namedAttendees : []),
      ...localNames,
    ].filter((name, idx, arr) => {
      const key = String(name).toLowerCase();
      return (
        key.length >= 2 &&
        arr.findIndex((n) => String(n).toLowerCase() === key) === idx
      );
    });
    const cancelConfidence = Math.max(
      localCancel.confidence,
      typeof x.cancelConfidence === 'number' ? x.cancelConfidence : 0,
      x.isCancel ? 0.9 : 0,
    );
    const capacity =
      cancelConfidence >= 0.7 ? null : inferCapacityLocal(x, payload.text);
    const rescheduleConfidence = Math.max(
      localReschedule.confidence,
      typeof x.rescheduleConfidence === 'number' ? x.rescheduleConfidence : 0,
      x.isReschedule ? 0.85 : 0,
      payload.targetMessageId && cancelConfidence < 0.7 ? 0.75 : 0,
    );
    const isCancel = cancelConfidence >= 0.7 || Boolean(x.isCancel) || localCancel.matched;
    const targetEventId =
      payload.targetEventId ||
      extractAppEventIdFromText(payload.quotedText) ||
      extractAppEventIdFromText(payload.text);
    const body = {
      senderPhone: payload.senderPhone,
      senderLid: payload.senderLid ?? null,
      senderJid: payload.senderJid ?? null,
      senderName: payload.senderName ?? null,
      messageBody: payload.text ?? '',
      quotedText: payload.quotedText ?? null,
      whatsappMessageId: payload.whatsappMessageId,
      targetWhatsappMessageId: payload.targetMessageId,
      targetEventId,
      title: isCancel ? null : x.title,
      suggestedTime: isCancel ? null : x.suggestedTime,
      venue: isCancel ? null : x.venue,
      locationName: isCancel ? null : x.locationName,
      address: isCancel ? null : x.address,
      latitude: isCancel ? null : x.latitude,
      longitude: isCancel ? null : x.longitude,
      venueSlug: isCancel ? null : x.venueSlug,
      venueConfidence: isCancel ? null : x.venueConfidence,
      addressConfidence: isCancel ? null : x.addressConfidence,
      timeConfidence: isCancel ? null : x.timeConfidence,
      instructions: x.instructions,
      notes: x.notes,
      skillLevel: x.skillLevel,
      courtInfo: x.courtInfo,
      durationMinutes: x.durationMinutes,
      capacity,
      capacityConfidence: isCancel ? null : x.capacityConfidence,
      namedAttendees: isCancel ? [] : namedAttendees,
      isReschedule:
        !isCancel &&
        (Boolean(x.isReschedule) || localReschedule.matched || Boolean(payload.targetMessageId)),
      rescheduleConfidence: isCancel ? 0 : rescheduleConfidence,
      isCancel,
      cancelConfidence,
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
      `[whatsapp-bot] CREATE_EVENT title=${body.title} slug=${body.venueSlug} capacity=${body.capacity} attendees=${JSON.stringify(body.namedAttendees)} cancel=${body.isCancel}/${body.cancelConfidence} reschedule=${body.isReschedule}/${body.rescheduleConfidence} replyTo=${body.targetWhatsappMessageId ?? 'n/a'} eventId=${body.targetEventId ?? 'n/a'} addr=${body.address} time=${body.suggestedTime} vConf=${body.venueConfidence} aConf=${body.addressConfidence}`,
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
      reactorName: payload.senderName ?? null,
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

    const quoted = await resolveQuotedMessage(message);
    const targetEventId =
      extractAppEventIdFromText(quoted.text) ||
      extractAppEventIdFromText(message.body);

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
      targetMessageId: quoted.id,
      quotedText: quoted.text,
      targetEventId,
    };

    console.log(
      `[whatsapp-bot] Message lid=${senderLid ?? 'n/a'} phone=${senderPhone ?? 'n/a'} replyTo=${quoted.id ?? 'n/a'} eventId=${targetEventId ?? 'n/a'}: ${(payload.text || '').slice(0, 120)}`,
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
