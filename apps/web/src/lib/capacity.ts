/** True when capacity is a usable positive integer (not null/undefined/"null"). */
export function hasCapacity(capacity: unknown): capacity is number {
  return typeof capacity === 'number' && Number.isFinite(capacity) && capacity >= 0;
}

/** True when spotsLeft is a usable number (0 is valid). */
export function hasSpotsLeft(spotsLeft: unknown): spotsLeft is number {
  return typeof spotsLeft === 'number' && Number.isFinite(spotsLeft);
}

/**
 * Human-readable capacity line for event detail.
 * Never renders the strings "null" or "undefined".
 */
export function formatSpotsLabel(opts: {
  capacity: unknown;
  spotsLeft: unknown;
  waitlistCount?: number | null;
  isFull?: boolean;
}): string {
  if (!hasCapacity(opts.capacity)) return 'Unlimited spots';
  const full =
    opts.isFull === true ||
    (hasSpotsLeft(opts.spotsLeft) && opts.spotsLeft === 0);
  if (full) {
    const wait = typeof opts.waitlistCount === 'number' ? opts.waitlistCount : 0;
    return `Full — ${wait} on the waitlist`;
  }
  if (!hasSpotsLeft(opts.spotsLeft)) {
    return `${opts.capacity} spots total`;
  }
  return `${opts.spotsLeft} of ${opts.capacity} spots left`;
}
