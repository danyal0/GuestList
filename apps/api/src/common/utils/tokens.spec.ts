import { generateOpaqueToken, hashToken } from './tokens';

describe('generateOpaqueToken', () => {
  it('produces URL-safe base64 output', () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('encodes the requested entropy (48 bytes → 64 chars)', () => {
    expect(generateOpaqueToken(48)).toHaveLength(64);
  });

  it('never repeats across calls', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(100);
  });
});

describe('hashToken', () => {
  it('is deterministic', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('produces a 64-char hex SHA-256 digest', () => {
    expect(hashToken('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});
