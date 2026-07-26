import { randomBytes } from 'crypto';

/** URL-safe slug from arbitrary text, with a random suffix to avoid collisions. */
export function slugify(input: string, withSuffix = true): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const safeBase = base.length > 0 ? base : 'item';
  return withSuffix ? `${safeBase}-${randomBytes(3).toString('hex')}` : safeBase;
}
