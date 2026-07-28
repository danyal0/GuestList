import { timingSafeEqual } from 'crypto';

/**
 * Validate the shared secret sent by the long-running WhatsApp bridge.
 * Uses a constant-time comparison to avoid timing leaks.
 */
export function isValidWhatsappBotToken(headerValue: string | null): boolean {
  const expected = process.env.WHATSAPP_BOT_TOKEN;
  if (!expected || !headerValue) return false;

  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Normalize phone numbers to digits-only for DB lookups. */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}
