import {
  preferPmForTennisHour,
  resolveMilwaukeeVenue,
} from './whatsapp-event-enrich';

describe('resolveMilwaukeeVenue', () => {
  it('maps lake front to Lake Park courts', () => {
    const v = resolveMilwaukeeVenue('lets play at lake front');
    expect(v?.locationName).toBe('Lake Park Tennis Courts');
    expect(v?.address).toContain('Lake Dr');
  });

  it('returns null for unknown places', () => {
    expect(resolveMilwaukeeVenue('random gym')).toBeNull();
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
