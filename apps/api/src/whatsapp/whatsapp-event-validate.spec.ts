import { resolveCatalogVenue } from './whatsapp-event-enrich';
import {
  assessEventSense,
  detectSportFromText,
  hasExplicitTimeCue,
  isSportCompatibleWithVenue,
  isWithinVenueHours,
  validateWhatsappEventCreate,
  validateWhatsappEventProposal,
} from './whatsapp-event-validate';

describe('detectSportFromText', () => {
  it('detects court and water sports', () => {
    expect(detectSportFromText('tennis at 6')).toBe('TENNIS');
    expect(detectSportFromText('Pickleball tonight')).toBe('PICKLEBALL');
    expect(detectSportFromText('basketball at washington')).toBe('BASKETBALL');
    expect(detectSportFromText('swimming at Atwater')).toBe('SWIMMING');
  });
});

describe('isSportCompatibleWithVenue', () => {
  it('allows racket/court sports on tennis courts', () => {
    expect(isSportCompatibleWithVenue('TENNIS', 'TENNIS')).toBe(true);
    expect(isSportCompatibleWithVenue('PICKLEBALL', 'TENNIS')).toBe(true);
    expect(isSportCompatibleWithVenue('BASKETBALL', 'TENNIS')).toBe(true);
  });

  it('rejects swimming / soccer on tennis courts', () => {
    expect(isSportCompatibleWithVenue('SWIMMING', 'TENNIS')).toBe(false);
    expect(isSportCompatibleWithVenue('SOCCER', 'TENNIS')).toBe(false);
  });
});

describe('hasExplicitTimeCue', () => {
  it('finds casual and ISO times', () => {
    expect(hasExplicitTimeCue('6pm')).toBe(true);
    expect(hasExplicitTimeCue('tennis at Atwater')).toBe(false);
    expect(hasExplicitTimeCue('2026-07-30T02:00:00-05:00')).toBe(true);
  });
});

describe('isWithinVenueHours', () => {
  const venue = resolveCatalogVenue('atwater')!.venue;
  it('accepts evening tennis and rejects 2am', () => {
    expect(
      isWithinVenueHours(
        new Date('2026-07-30T23:00:00.000Z'),
        'America/Chicago',
        venue,
      ),
    ).toBe(true);
    expect(
      isWithinVenueHours(
        new Date('2026-07-30T07:00:00.000Z'),
        'America/Chicago',
        venue,
      ),
    ).toBe(false);
  });
});

describe('assessEventSense', () => {
  const atwater = resolveCatalogVenue('atwater')!.venue;
  const evening = new Date('2026-07-30T23:00:00.000Z');

  it('is confident for tennis + known court + explicit time', () => {
    const sense = assessEventSense({
      mode: 'create',
      messageBody: 'tennis at Atwater at 6pm',
      catalogVenue: atwater,
      startTime: evening,
      timezone: 'America/Chicago',
      timeWasExplicit: true,
      venueWasExplicit: true,
      botConfidence: 0.9,
    });
    expect(sense.makesSense).toBe(true);
    expect(sense.confidence).toBeGreaterThanOrEqual(0.72);
  });

  it('rejects reschedule with no material change', () => {
    const sense = assessEventSense({
      mode: 'reschedule',
      messageBody: 'still on',
      catalogVenue: atwater,
      startTime: evening,
      timezone: 'America/Chicago',
      changes: { timeChanged: false, venueChanged: false },
    });
    expect(sense.makesSense).toBe(false);
  });
});

describe('validateWhatsappEventCreate / proposal', () => {
  const atwater = resolveCatalogVenue('atwater')!.venue;
  const evening = new Date('2026-07-30T23:00:00.000Z');
  const twoAm = new Date('2026-07-30T07:00:00.000Z');

  it('rejects time-only messages', () => {
    const result = validateWhatsappEventCreate({
      messageBody: '6pm',
      startTime: evening,
      timezone: 'America/Chicago',
      timeWasExplicit: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INCOMPLETE');
  });

  it('rejects sport + time without a known venue', () => {
    const result = validateWhatsappEventCreate({
      messageBody: 'tennis at 6pm',
      startTime: evening,
      timezone: 'America/Chicago',
      timeWasExplicit: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('MISSING_VENUE');
  });

  it('accepts tennis + catalog venue with sense gate', () => {
    const result = validateWhatsappEventProposal({
      mode: 'create',
      messageBody: 'tennis at Atwater at 6pm',
      catalogVenue: atwater,
      startTime: evening,
      timezone: 'America/Chicago',
      timeWasExplicit: true,
      venueWasExplicit: true,
      botConfidence: 0.85,
    });
    expect(result).toEqual({ ok: true });
  });

  it('accepts pickleball at tennis courts', () => {
    const result = validateWhatsappEventProposal({
      mode: 'create',
      messageBody: 'pickleball at Atwater at 6pm',
      catalogVenue: atwater,
      startTime: evening,
      timezone: 'America/Chicago',
      timeWasExplicit: true,
      venueWasExplicit: true,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects swimming at tennis courts', () => {
    const result = validateWhatsappEventProposal({
      mode: 'create',
      messageBody: 'swimming at Atwater at 6pm',
      catalogVenue: atwater,
      startTime: evening,
      timezone: 'America/Chicago',
      timeWasExplicit: true,
      venueWasExplicit: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SPORT_VENUE_MISMATCH');
  });

  it('rejects unrealistic hours', () => {
    const result = validateWhatsappEventProposal({
      mode: 'create',
      messageBody: 'tennis at Atwater tomorrow at 2am',
      catalogVenue: atwater,
      startTime: twoAm,
      timezone: 'America/Chicago',
      timeWasExplicit: true,
      venueWasExplicit: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OUTSIDE_HOURS');
  });

  it('requires a material time/venue change on reschedule', () => {
    const result = validateWhatsappEventProposal({
      mode: 'reschedule',
      messageBody: 'still happening',
      catalogVenue: atwater,
      startTime: evening,
      timezone: 'America/Chicago',
      timeWasExplicit: false,
      venueWasExplicit: false,
      changes: { timeChanged: false, venueChanged: false },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NO_MATERIAL_CHANGE');
  });

  it('validates reschedule time change against hours', () => {
    const result = validateWhatsappEventProposal({
      mode: 'reschedule',
      messageBody: 'moved to 2am',
      catalogVenue: atwater,
      startTime: twoAm,
      timezone: 'America/Chicago',
      timeWasExplicit: true,
      venueWasExplicit: false,
      changes: { timeChanged: true, venueChanged: false },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OUTSIDE_HOURS');
  });

  it('accepts reschedule to a sensible new time', () => {
    const result = validateWhatsappEventProposal({
      mode: 'reschedule',
      messageBody: 'moved to 7pm',
      catalogVenue: atwater,
      startTime: new Date('2026-07-31T00:00:00.000Z'), // 7pm CDT
      timezone: 'America/Chicago',
      timeWasExplicit: true,
      venueWasExplicit: false,
      botConfidence: 0.9,
      changes: { timeChanged: true, venueChanged: false },
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects when AI sense-check is not confident', () => {
    const result = validateWhatsappEventProposal({
      mode: 'create',
      messageBody: 'tennis at Atwater at 6pm',
      catalogVenue: atwater,
      startTime: evening,
      timezone: 'America/Chicago',
      timeWasExplicit: true,
      venueWasExplicit: true,
      botConfidence: 0.95,
      aiSenseConfidence: 0.3,
      aiSenseReason: 'Sounds incomplete / joke',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('LOW_CONFIDENCE');
  });
});
