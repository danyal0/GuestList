import { formatSpotsLabel, hasCapacity, hasSpotsLeft } from './capacity';

describe('capacity display helpers', () => {
  it('rejects null/undefined/"null" as capacity', () => {
    expect(hasCapacity(null)).toBe(false);
    expect(hasCapacity(undefined)).toBe(false);
    expect(hasCapacity('null' as unknown as number)).toBe(false);
    expect(hasCapacity(12)).toBe(true);
  });

  it('never renders null of undefined', () => {
    expect(formatSpotsLabel({ capacity: undefined, spotsLeft: null })).toBe('Unlimited spots');
    expect(formatSpotsLabel({ capacity: null, spotsLeft: null })).toBe('Unlimited spots');
    expect(formatSpotsLabel({ capacity: 12, spotsLeft: 10 })).toBe('10 of 12 spots left');
    expect(
      formatSpotsLabel({ capacity: 12, spotsLeft: 0, waitlistCount: 2, isFull: true }),
    ).toBe('Full — 2 on the waitlist');
  });

  it('treats 0 spotsLeft as a valid number', () => {
    expect(hasSpotsLeft(0)).toBe(true);
    expect(hasSpotsLeft(null)).toBe(false);
  });
});
