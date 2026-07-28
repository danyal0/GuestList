import {
  detectCancelCues,
  detectRescheduleCues,
  extractEventIdFromText,
  extractMapsUrls,
  extractNamedAttendeesFromMessage,
  hasPlaceCue,
  inferEventCapacity,
  mergeNamedAttendees,
  preferPmForTennisHour,
  resolveCatalogVenue,
  resolveMilwaukeeVenue,
  scoreRescheduleCandidate,
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

describe('detectRescheduleCues / scoreRescheduleCandidate', () => {
  const sample =
    'Khatera and I are going to play tennis at Atwater Elementary School in Shorewood about 6 pm (earlier than planned). Everyone else is welcome too!\nhttps://maps.app.goo.gl/5WAt3wATnqqesNv6A';

  it('flags earlier than planned as a strong reschedule cue', () => {
    const cue = detectRescheduleCues(sample);
    expect(cue.matched).toBe(true);
    expect(cue.direction).toBe('earlier');
    expect(cue.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('extracts Google Maps short links', () => {
    expect(extractMapsUrls(sample)).toEqual([
      'https://maps.app.goo.gl/5WAt3wATnqqesNv6A',
    ]);
  });

  it('scores the host Atwater event highly for this reschedule message', () => {
    const venue = resolveCatalogVenue(sample)!.venue;
    const laterSameDay = new Date('2026-07-28T23:00:00.000Z'); // ~6pm Chicago
    const earlierPlan = new Date('2026-07-29T01:00:00.000Z'); // ~8pm Chicago
    const newStart = laterSameDay;
    const score = scoreRescheduleCandidate(
      {
        id: 'evt_1',
        title: 'Atwater Elementary tennis 6pm',
        startTime: earlierPlan,
        endTime: new Date(earlierPlan.getTime() + 90 * 60 * 1000),
        locationName: venue.name,
        address: venue.address,
        venueId: 'venue_atwater',
        whatsappMessageId: 'wamid_old',
        description: 'prior invite',
        capacity: 12,
      },
      {
        venueId: 'venue_atwater',
        locationName: venue.name,
        address: venue.address,
        newStart,
        messageBody: sample,
        direction: 'earlier',
        timezone: 'America/Chicago',
      },
    );
    expect(score).toBeGreaterThanOrEqual(0.7);
  });

  it('extracts Khatera from Khatera and I', () => {
    expect(extractNamedAttendeesFromMessage(sample)).toEqual(
      expect.arrayContaining(['Khatera']),
    );
  });
});

describe('detectCancelCues', () => {
  it('flags cancelled with restated time/venue as a cancel (not a create)', () => {
    const cue = detectCancelCues(
      'Atwater 6pm is cancelled — sorry everyone',
    );
    expect(cue.matched).toBe(true);
    expect(cue.confidence).toBeGreaterThanOrEqual(0.9);
    expect(cue.matchedPhrase?.toLowerCase()).toMatch(/cancell?ed/);
  });

  it('flags short reply "its cancelled"', () => {
    expect(detectCancelCues('its cancelled').matched).toBe(true);
    expect(detectCancelCues("it's canceled").matched).toBe(true);
  });

  it('flags called off / not happening', () => {
    expect(detectCancelCues('tennis tonight is called off').matched).toBe(true);
    expect(detectCancelCues('not happening today').matched).toBe(true);
    expect(detectCancelCues('rained out at McKinley').matched).toBe(true);
  });

  it('does not treat a normal invite as cancel', () => {
    expect(
      detectCancelCues('Tennis at Atwater tomorrow 6pm — everyone welcome').matched,
    ).toBe(false);
  });

  it('cancel cues beat reschedule when both appear', () => {
    const text = 'the 6pm Atwater game earlier than planned is cancelled';
    expect(detectCancelCues(text).matched).toBe(true);
    expect(detectRescheduleCues(text).matched).toBe(true);
  });

  it('extracts app event ids from share links', () => {
    expect(
      extractEventIdFromText('see https://mkeplays.app/events/evt_abc123xyz for details'),
    ).toBe('evt_abc123xyz');
    expect(extractEventIdFromText('its cancelled')).toBeNull();
  });

  it('detects place cues only when the message mentions a place', () => {
    expect(hasPlaceCue('its cancelled')).toBe(false);
    expect(hasPlaceCue('Atwater 6pm cancelled')).toBe(true);
  });
});
