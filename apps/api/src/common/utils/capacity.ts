/** Normalize DB/API capacity: only finite numbers count; everything else → null. */
export function normalizeCapacity(capacity: unknown): number | null {
  if (typeof capacity !== 'number' || !Number.isFinite(capacity) || capacity < 0) {
    return null;
  }
  return Math.floor(capacity);
}

export function computeSpotsLeft(
  capacity: unknown,
  goingCount: number,
): number | null {
  const cap = normalizeCapacity(capacity);
  if (cap === null) return null;
  return Math.max(0, cap - (Number.isFinite(goingCount) ? goingCount : 0));
}
