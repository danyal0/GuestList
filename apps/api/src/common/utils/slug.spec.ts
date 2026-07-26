import { slugify } from './slug';

describe('slugify', () => {
  it('lowercases and replaces non-alphanumerics with hyphens', () => {
    expect(slugify('Hello World!', false)).toBe('hello-world');
  });

  it('strips diacritics', () => {
    expect(slugify('Café Société', false)).toBe('cafe-societe');
  });

  it('collapses consecutive separators and trims edge hyphens', () => {
    expect(slugify('  --Weekly   Run__Club--  ', false)).toBe('weekly-run-club');
  });

  it('truncates the base to 60 characters', () => {
    const long = 'a'.repeat(120);
    expect(slugify(long, false)).toHaveLength(60);
  });

  it('falls back to "item" when nothing survives sanitization', () => {
    expect(slugify('!!!***', false)).toBe('item');
  });

  it('appends a 6-hex-char random suffix by default', () => {
    const slug = slugify('Board Games');
    expect(slug).toMatch(/^board-games-[0-9a-f]{6}$/);
  });

  it('generates different suffixes across calls (collision avoidance)', () => {
    const slugs = new Set(Array.from({ length: 20 }, () => slugify('x')));
    expect(slugs.size).toBeGreaterThan(1);
  });
});
