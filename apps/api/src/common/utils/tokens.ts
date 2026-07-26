import { createHash, randomBytes } from 'crypto';

/**
 * Opaque tokens (refresh, email verification, password reset) are high-entropy
 * random values, so a fast SHA-256 digest is the appropriate storage hash —
 * unlike passwords, they cannot be brute-forced offline, and the digest
 * doubles as a unique lookup key.
 */
export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
