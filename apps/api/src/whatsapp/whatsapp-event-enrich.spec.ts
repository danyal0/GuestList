import {
  extractNamedAttendeesFromMessage,
  inferEventCapacity,
  mergeNamedAttendees,
  preferPmForTennisHour,
  resolveCatalogVenue,
  resolveMilwaukeeVenue,
} from './whatsapp-event-enrich';
import { computeSpotsLeft, normalizeCapacity } from '../common/utils/capacity';

describe('resolveCatalogVenue', () => {
  it('maps lake front tennis to McKinley Tennis Courts', () => {
    const match = resolveCatalogVenue('lets play at lake front at 6 tomorrow');
    expect(match?.venue.name).toBe('McKinley Tennis Courts');
    expect(match?.venue.address).toContain('Lincoln Memorial');
    expect(match?.matchedAlias).toMatch(/lake ?front/);
    expect(match?.venue.defaultCapacity).toBe(24);
    expect(match?.venue.courtCount).toBe(6);
  });

  it('maps lake park explicitly to Lake Park courts (not McKinley)', () => {
    const match = resolveCatalogVenue('lake park tomorrow');
    expect(match?.venue.slug).toBe('lake-park-tennis-courts');
  });

  it('maps atwater to Shorewood elementary courts', () => {
    const match = resolveCatalogVenue('Atwater Elementary tennis 6pm');
    expect(match?.venue.slug).toBe('atwater-elementary-tennis');
    expect(match?.venue.address).toContain('Capitol');
    expect(match?.venue.defaultCapacity).toBe(12);
  });

  it('returns null for unknown places', () => {
    expect(resolveMilwaukeeVenue('random gym downtown')).toBeNull();
  });
});

describe('preferPmForTennisHour', () => {
  it('biases 6 toward 18 when am/pm omitted', () => {
    expect(preferPmForTennisHour(6, false)).toBe(18);
  });

  it('keeps explicit morning hours', () => {
    expect(preferPmForTennisHour(6, true)).toBe(6);
  });
});

describe('inferEventCapacity', () => {
  it('uses AI capacity when confident', () => {
    expect(
      inferEventCapacity({
        aiCapacity: 4,
        capacityConfidence: 0.9,
        venue: resolveCatalogVenue('mckinley')!.venue,
      }),
    ).toBe(4);
  });

  it('uses doubles cue from message', () => {
    expect(inferEventCapacity({ messageBody: 'doubles tomorrow at lake front' })).toBe(4);
  });

  it('falls back to venue defaultCapacity', () => {
    const venue = resolveCatalogVenue('lake front')!.venue;
    expect(inferEventCapacity({ messageBody: 'tennis at lake front 6', venue })).toBe(24);
  });

  it('uses Atwater venue capacity for atwater messages', () => {
    const venue = resolveCatalogVenue('atwater elementary')!.venue;
    expect(inferEventCapacity({ messageBody: 'Atwater Elementary tennis 6pm', venue })).toBe(12);
  });
});

describe('extractNamedAttendeesFromMessage', () => {
  it('picks up Khatera from "khatera is also going"', () => {
    expect(
      extractNamedAttendeesFromMessage(
        'Atwater Elementary tennis 6pm — khatera is also going',
      ),
    ).toEqual(['Khatera']);
  });

  it('merges AI and local names without duplicates', () => {
    expect(
      mergeNamedAttendees(
        ['Khatera'],
        'me and Sam are playing; khatera is also going',
        ['Danyal'],
      ),
    ).toEqual(expect.arrayContaining(['Khatera', 'Sam']));
  });
});

describe('normalizeCapacity / computeSpotsLeft', () => {
  it('treats undefined/null as unlimited', () => {
    expect(normalizeCapacity(undefined)).toBeNull();
    expect(normalizeCapacity(null)).toBeNull();
    expect(computeSpotsLeft(undefined, 1)).toBeNull();
  });

  it('computes remaining spots', () => {
    expect(computeSpotsLeft(12, 2)).toBe(10);
    expect(computeSpotsLeft(1, 3)).toBe(0);
  });
});
