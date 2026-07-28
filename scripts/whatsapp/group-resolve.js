'use strict';

/**
 * Pure helpers for WhatsApp group targeting.
 * Kept free of puppeteer / whatsapp-web.js so we can unit-test the paths that
 * previously broke when getChats()/getChat() threw `r: r`.
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeGroupId(value) {
  if (value == null) return null;
  let id = String(value).trim();
  if (!id) return null;
  if (/^\d+$/.test(id)) id = `${id}@g.us`;
  return id.endsWith('@g.us') ? id : null;
}

/**
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
function parseInviteCode(raw) {
  if (!raw) return null;
  const fromUrl = String(raw).match(
    /chat\.whatsapp\.com\/([A-Za-z0-9]+)(?:[?#].*)?$/,
  );
  if (fromUrl) return fromUrl[1];
  const trimmed = String(raw).trim();
  return /^[A-Za-z0-9]+$/.test(trimmed) ? trimmed : null;
}

/**
 * @param {{
 *   groupId?: string | null,
 *   autoLearn?: boolean,
 *   log?: (...args: unknown[]) => void,
 * }} [options]
 */
function createGroupResolver(options = {}) {
  let targetGroupId = normalizeGroupId(options.groupId);
  const autoLearn = options.autoLearn !== false;
  const log = options.log || (() => {});

  function getId() {
    return targetGroupId;
  }

  function setId(value) {
    targetGroupId = normalizeGroupId(value);
    return targetGroupId;
  }

  /**
   * Learn / pin the group JID from an inbound group message when unset.
   * @param {string} chatId
   */
  function maybeLearnGroupId(chatId) {
    if (targetGroupId) return targetGroupId;
    const id = normalizeGroupId(chatId);
    if (!id) return null;

    log(
      `[whatsapp-bot] Saw group message from ${id}. Pin permanently with WHATSAPP_GROUP_ID=${id}`,
    );

    if (!autoLearn) return null;

    targetGroupId = id;
    log(`[whatsapp-bot] Auto-learned target group id ${targetGroupId}`);
    return targetGroupId;
  }

  /**
   * @param {string | null | undefined} chatId
   */
  function isTargetGroupId(chatId) {
    if (!chatId || !String(chatId).endsWith('@g.us')) return false;
    if (!targetGroupId) return false;
    return chatId === targetGroupId;
  }

  /**
   * Decide whether an inbound WhatsApp message should be processed.
   * Never calls getChats/getChat — only uses message.from.
   * @param {{ from?: string, fromMe?: boolean, processSelf?: boolean }} message
   */
  function shouldProcessMessage(message) {
    const from = message?.from;
    if (from === 'status@broadcast') {
      return { ok: false, reason: 'status' };
    }
    if (message?.fromMe && message?.processSelf !== true) {
      return { ok: false, reason: 'self' };
    }
    if (!String(from || '').endsWith('@g.us')) {
      return { ok: false, reason: 'not-group' };
    }

    if (!targetGroupId) {
      maybeLearnGroupId(from);
    }

    if (!isTargetGroupId(from)) {
      return {
        ok: false,
        reason: targetGroupId ? 'wrong-group' : 'unresolved-group',
        groupId: targetGroupId,
      };
    }

    return { ok: true, groupId: targetGroupId };
  }

  return {
    getId,
    setId,
    maybeLearnGroupId,
    isTargetGroupId,
    shouldProcessMessage,
  };
}

/**
 * Extract digits-only phone from a contact-like or message-like object.
 * @param {any} source
 */
function extractPhone(source) {
  const number =
    source?.number ||
    String(source?.author || source?.from || '')
      .split('@')[0]
      .replace(/:\d+$/, '');

  return String(number || '').replace(/\D/g, '');
}

module.exports = {
  normalizeGroupId,
  parseInviteCode,
  createGroupResolver,
  extractPhone,
};
