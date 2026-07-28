import {
  preferPmForTennisHour,
  resolveCatalogVenue,
  resolveMilwaukeeVenue,
} from './whatsapp-event-enrich';

describe('resolveCatalogVenue', () => {
  it('maps lake front tennis to McKinley Tennis Courts', () => {
    const match = resolveCatalogVenue('lets play at lake front at 6 tomorrow');
    expect(match?.venue.name).toBe('McKinley Tennis Courts');
    expect(match?.venue.address).toContain('Lincoln Memorial');
    expect(match?.matchedAlias).toMatch(/lake ?front/);
  });

  it('maps lake park explicitly to Lake Park courts (not McKinley)', () => {
    const match = resolveCatalogVenue('lake park tomorrow');
    expect(match?.venue.slug).toBe('lake-park-tennis-courts');
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
