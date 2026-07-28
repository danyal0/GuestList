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

/**
 * Common storage variants for the same handset number.
 * WhatsApp often omits the leading US `1`; signup usually includes it.
 */
export function phoneLookupVariants(digits: string): string[] {
  const out = new Set<string>();
  if (!digits) return [];
  out.add(digits);
  if (digits.length === 11 && digits.startsWith('1')) {
    out.add(digits.slice(1));
  }
  if (digits.length === 10) {
    out.add(`1${digits}`);
  }
  return [...out];
}

/** Prefer NANP with country code when we only have 10 digits. */
export function preferCanonicalPhone(digits: string): string {
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = phoneLookupVariants(a);
  const right = new Set(phoneLookupVariants(b));
  return left.some((v) => right.has(v));
}

/** Prisma `where` fragment matching any common variant of a phone. */
export function phoneMatchWhere(digits: string): { OR: Array<{ phone: string } | { phone: { endsWith: string } }> } {
  const variants = phoneLookupVariants(digits);
  return {
    OR: variants.flatMap((v) => [{ phone: v }, { phone: { endsWith: v } }]),
  };
}
