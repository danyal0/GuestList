import { resolveCatalogVenue } from './whatsapp-event-enrich';
import {
  detectSportFromText,
  hasExplicitTimeCue,
  isWithinVenueHours,
  validateWhatsappEventCreate,
} from './whatsapp-event-validate';

describe('detectSportFromText', () => {
  it('detects tennis and pickleball', () => {
    expect(detectSportFromText('tennis at 6')).toBe('TENNIS');
    expect(detectSportFromText('Pickleball tonight')).toBe('PICKLEBALL');
    expect(detectSportFromText('basketball at washington')).toBe('BASKETBALL');
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
        new Date('2026-07-30T23:00:00.000Z'), // 6pm Chicago
        'America/Chicago',
        venue,
      ),
    ).toBe(true);
    expect(
      isWithinVenueHours(
        new Date('2026-07-30T07:00:00.000Z'), // 2am Chicago
        'America/Chicago',
        venue,
      ),
    ).toBe(false);
  });
});

describe('validateWhatsappEventCreate', () => {
  const atwater = resolveCatalogVenue('atwater')!.venue;
  const evening = new Date('2026-07-30T23:00:00.000Z'); // 6pm CDT
  const twoAm = new Date('2026-07-30T07:00:00.000Z'); // 2am CDT

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

  it('accepts sport + catalog venue with default-friendly time', () => {
    const result = validateWhatsappEventCreate({
      messageBody: 'tennis at Atwater',
      catalogVenue: atwater,
      startTime: evening,
      timezone: 'America/Chicago',
      timeWasExplicit: false,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects unrealistic hours at a known venue', () => {
    const result = validateWhatsappEventCreate({
      messageBody: 'tennis at Atwater tomorrow at 2am',
      suggestedTime: '2026-07-30T02:00:00-05:00',
      catalogVenue: atwater,
      startTime: twoAm,
      timezone: 'America/Chicago',
      timeWasExplicit: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OUTSIDE_HOURS');
  });

  it('rejects unknown non-court venues even with free-form location', () => {
    const result = validateWhatsappEventCreate({
      messageBody: 'tennis at Fiserv Forum at 6pm',
      freeformLocation: 'Fiserv Forum',
      startTime: evening,
      timezone: 'America/Chicago',
      timeWasExplicit: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN_VENUE');
  });

  it('rejects unsupported sports even when a tennis park alias matches', () => {
    const washington = resolveCatalogVenue('washington park')!.venue;
    const result = validateWhatsappEventCreate({
      messageBody: 'basketball at Washington Park at 6pm',
      catalogVenue: washington,
      startTime: evening,
      timezone: 'America/Chicago',
      timeWasExplicit: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNSUPPORTED_SPORT');
  });

  it('rejects pickleball (unsupported) at Atwater', () => {
    const result = validateWhatsappEventCreate({
      messageBody: 'pickleball at Atwater at 6pm',
      catalogVenue: atwater,
      startTime: evening,
      timezone: 'America/Chicago',
      timeWasExplicit: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNSUPPORTED_SPORT');
  });
});
