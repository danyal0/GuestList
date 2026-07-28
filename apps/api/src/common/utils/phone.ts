/**
 * Normalize phone / WhatsApp identifiers to digits-only for storage and lookup.
 */
export function normalizePhoneDigits(value: string | null | undefined): string | null {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, '');
  return digits.length ? digits : null;
}

/**
 * Extract WhatsApp LID local-part (digits) from a JID like `123@lid` or raw digits.
 */
export function normalizeWhatsappLid(value: string | null | undefined): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const local = raw.includes('@') ? raw.split('@')[0]! : raw;
  const digits = local.replace(/\D/g, '');
  return digits.length ? digits : null;
}

/** Basic E.164-ish length check for user-entered phones (7–15 digits). */
export function isPlausiblePhone(digits: string): boolean {
  return digits.length >= 7 && digits.length <= 15;
}
