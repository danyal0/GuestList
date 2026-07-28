import { cn, formatDate, formatRelative, formatTime, initials } from './utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('resolves Tailwind conflicts, keeping the last class', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('ignores falsy values', () => {
    expect(cn('a', false && 'b', undefined, null, 'c')).toBe('a c');
  });
});

describe('formatDate / formatTime', () => {
  it('formats a date with weekday, month and day', () => {
    const formatted = formatDate('2030-05-01T12:00:00Z');
    expect(formatted).toMatch(/May/);
    expect(formatted).toMatch(/1/);
  });

  it('formats a time with hour and minutes', () => {
    expect(formatTime(new Date(2030, 4, 1, 9, 5))).toMatch(/9:05/);
  });
});

describe('formatRelative', () => {
  it('returns "now" for very recent timestamps', () => {
    expect(formatRelative(new Date())).toBe('now');
  });

  it('returns minutes under an hour', () => {
    expect(formatRelative(new Date(Date.now() - 5 * 60_000))).toBe('5m');
  });

  it('returns hours under a day', () => {
    expect(formatRelative(new Date(Date.now() - 3 * 3_600_000))).toBe('3h');
  });

  it('returns days under a week', () => {
    expect(formatRelative(new Date(Date.now() - 2 * 86_400_000))).toBe('2d');
  });

  it('falls back to a date for older timestamps', () => {
    const old = new Date(Date.now() - 30 * 86_400_000);
    expect(formatRelative(old)).toMatch(/[A-Z][a-z]{2}/);
  });
});

describe('initials', () => {
  it('takes the first letters of the first two words', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
  });

  it('handles single names', () => {
    expect(initials('Cher')).toBe('C');
  });

  it('ignores extra whitespace', () => {
    expect(initials('  Grace   Hopper  ')).toBe('GH');
  });

  it('caps at two initials', () => {
    expect(initials('Jean Luc Picard')).toBe('JL');
  });

  it('returns ? for empty or missing names', () => {
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
    expect(initials(undefined)).toBe('?');
  });
});

describe('invalid dates', () => {
  it('formatDate returns empty string for invalid input', () => {
    expect(formatDate(undefined)).toBe('');
    expect(formatDate(null)).toBe('');
    expect(formatDate('not-a-date')).toBe('');
  });

  it('formatRelative returns empty string for invalid input', () => {
    expect(formatRelative(undefined)).toBe('');
    expect(formatRelative('nope')).toBe('');
  });
});
