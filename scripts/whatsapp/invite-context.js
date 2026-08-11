/**
 * Per-group rolling chat memory + pending invite draft for WhatsApp tennis planning.
 * Lets follow-ups ("where?", "what about Atwater?") complete a prior "tomorrow evening" ask.
 */

'use strict';

const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;
const DEFAULT_MAX_MESSAGES = 12;

const DAYPART_RE =
  /\b(this\s+)?(morning|afternoon|evening|tonight|noon)\b/i;
const NUMERIC_TIME_RE =
  /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i;

function hasTimeCue(text) {
  if (!text) return false;
  const t = String(text);
  return DAYPART_RE.test(t) || NUMERIC_TIME_RE.test(t) || /\b\d{4}-\d{2}-\d{2}t\d{2}:/i.test(t);
}

function hasVenueFields(fields) {
  if (!fields) return false;
  if (fields.venueSlug) return true;
  if (fields.address && /\d/.test(String(fields.address))) return true;
  if ((fields.venueConfidence ?? 0) >= 0.8 && (fields.venue || fields.locationName)) {
    return true;
  }
  return false;
}

function draftIsComplete(draft) {
  if (!draft) return false;
  const timeOk =
    Boolean(draft.suggestedTime) ||
    hasTimeCue(draft.suggestedTime) ||
    hasTimeCue(draft.contextText);
  return hasVenueFields(draft) && timeOk;
}

/**
 * @param {{ ttlMs?: number, maxMessages?: number }} [opts]
 */
function createInviteContextStore(opts = {}) {
  const ttlMs = opts.ttlMs ?? Number(process.env.WHATSAPP_CONTEXT_TTL_MS || DEFAULT_TTL_MS);
  const maxMessages =
    opts.maxMessages ??
    Number(process.env.WHATSAPP_CONTEXT_MAX_MESSAGES || DEFAULT_MAX_MESSAGES);

  /** @type {Map<string, any>} */
  const byGroup = new Map();

  function get(groupKey) {
    const key = groupKey || 'default';
    let ctx = byGroup.get(key);
    if (!ctx) {
      ctx = {
        messages: [],
        draft: null,
        /** @type {Map<string, string>} messageId → primary invite whatsappMessageId */
        rsvpAliases: new Map(),
        lastInviteWhatsappId: null,
        lastInviteAt: 0,
      };
      byGroup.set(key, ctx);
    }
    prune(ctx);
    return ctx;
  }

  function prune(ctx) {
    const cutoff = Date.now() - ttlMs;
    ctx.messages = ctx.messages
      .filter((m) => m.at >= cutoff)
      .slice(-maxMessages);
    if (ctx.draft && ctx.draft.updatedAt < cutoff) {
      ctx.draft = null;
    }
    if (ctx.lastInviteAt && ctx.lastInviteAt < cutoff) {
      ctx.lastInviteWhatsappId = null;
      ctx.lastInviteAt = 0;
    }
    for (const [msgId, meta] of [...ctx.rsvpAliases.entries()]) {
      if (typeof meta === 'object' && meta.at < cutoff) {
        ctx.rsvpAliases.delete(msgId);
      } else if (typeof meta === 'string' && ctx.lastInviteAt < cutoff) {
        ctx.rsvpAliases.delete(msgId);
      }
    }
  }

  function pushMessage(groupKey, entry) {
    const ctx = get(groupKey);
    const text = (entry.text || '').trim();
    if (!text) return ctx;
    ctx.messages.push({
      id: entry.id || null,
      text: text.slice(0, 400),
      senderName: entry.senderName || null,
      at: entry.at || Date.now(),
    });
    prune(ctx);
    return ctx;
  }

  function recentForPrompt(groupKey) {
    const ctx = get(groupKey);
    return ctx.messages.slice(-8).map((m) => ({
      sender: m.senderName || 'member',
      text: m.text,
    }));
  }

  function pendingDraftForPrompt(groupKey) {
    const draft = get(groupKey).draft;
    if (!draft) return null;
    return {
      title: draft.title,
      suggestedTime: draft.suggestedTime,
      venue: draft.venue,
      locationName: draft.locationName,
      address: draft.address,
      venueSlug: draft.venueSlug,
      venueConfidence: draft.venueConfidence,
      timeConfidence: draft.timeConfidence,
      contextText: draft.contextText,
      relatedMessageIds: draft.relatedMessageIds,
    };
  }

  /**
   * Merge AI extract + current message into the pending draft.
   * @returns {object | null} updated draft
   */
  function mergeDraft(groupKey, extracted, messageMeta) {
    const ctx = get(groupKey);
    const prev = ctx.draft || {
      title: null,
      suggestedTime: null,
      venue: null,
      locationName: null,
      address: null,
      venueSlug: null,
      latitude: null,
      longitude: null,
      venueConfidence: null,
      addressConfidence: null,
      timeConfidence: null,
      contextText: '',
      relatedMessageIds: [],
      updatedAt: Date.now(),
    };

    const x = extracted || {};
    const next = { ...prev };

    const take = (key, preferTruthy = true) => {
      const v = x[key];
      if (v == null || v === '') return;
      if (preferTruthy || !next[key]) next[key] = v;
    };

    take('title');
    take('suggestedTime');
    take('venue');
    take('locationName');
    take('address');
    take('venueSlug');
    if (x.latitude != null) next.latitude = x.latitude;
    if (x.longitude != null) next.longitude = x.longitude;
    if (typeof x.venueConfidence === 'number') {
      next.venueConfidence = Math.max(next.venueConfidence || 0, x.venueConfidence);
    }
    if (typeof x.addressConfidence === 'number') {
      next.addressConfidence = Math.max(
        next.addressConfidence || 0,
        x.addressConfidence,
      );
    }
    if (typeof x.timeConfidence === 'number') {
      next.timeConfidence = Math.max(next.timeConfidence || 0, x.timeConfidence);
    }

    const msgText = (messageMeta?.text || '').trim();
    if (msgText) {
      const bits = [next.contextText, msgText].filter(Boolean);
      next.contextText = bits.join('\n').slice(-1200);
    }
    // Prefer daypart/time from the raw thread when AI omitted suggestedTime.
    if (!next.suggestedTime && hasTimeCue(next.contextText)) {
      const daypart = next.contextText.match(
        /\b(tomorrow|today|tonight|[A-Za-z]+day)?[^\n]{0,40}\b(morning|afternoon|evening|tonight|noon|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i,
      );
      if (daypart) {
        next.suggestedTime = daypart[0].trim();
        next.timeConfidence = Math.max(next.timeConfidence || 0, 0.75);
      }
    }

    const msgId = messageMeta?.id;
    if (msgId && !next.relatedMessageIds.includes(msgId)) {
      next.relatedMessageIds = [...next.relatedMessageIds, msgId].slice(-20);
    }
    next.updatedAt = Date.now();
    ctx.draft = next;
    return next;
  }

  function clearDraft(groupKey) {
    const ctx = get(groupKey);
    ctx.draft = null;
  }

  /**
   * After a successful create, map thread message ids → primary invite id for RSVPs.
   */
  function rememberInvite(groupKey, primaryWhatsappId, relatedIds = []) {
    const ctx = get(groupKey);
    const at = Date.now();
    ctx.lastInviteWhatsappId = primaryWhatsappId;
    ctx.lastInviteAt = at;
    const ids = new Set([primaryWhatsappId, ...relatedIds].filter(Boolean));
    for (const id of ids) {
      ctx.rsvpAliases.set(id, { primary: primaryWhatsappId, at });
    }
    ctx.draft = null;
  }

  function resolveRsvpTarget(groupKey, messageId) {
    const ctx = get(groupKey);
    if (!messageId) return ctx.lastInviteWhatsappId || null;
    const alias = ctx.rsvpAliases.get(messageId);
    if (alias) {
      return typeof alias === 'string' ? alias : alias.primary;
    }
    if (ctx.lastInviteWhatsappId) return ctx.lastInviteWhatsappId;
    return messageId;
  }

  return {
    get,
    pushMessage,
    recentForPrompt,
    pendingDraftForPrompt,
    mergeDraft,
    clearDraft,
    rememberInvite,
    resolveRsvpTarget,
    draftIsComplete: (groupKey) => draftIsComplete(get(groupKey).draft),
    hasTimeCue,
    hasVenueFields,
    _draftIsComplete: draftIsComplete,
  };
}

module.exports = {
  createInviteContextStore,
  draftIsComplete,
  hasTimeCue,
  hasVenueFields,
};
