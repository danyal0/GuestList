import {
  isPlausiblePhone,
  normalizePhoneDigits,
  phoneLookupVariants,
  phonesMatch,
  preferCanonicalPhone,
} from './phone';

describe('phone helpers', () => {
  it('normalizes formatted phones to digits', () => {
    expect(normalizePhoneDigits('+1 (414) 555-0100')).toBe('14145550100');
    expect(normalizePhoneDigits('414-555-0100')).toBe('4145550100');
  });

  it('builds US 10/11 digit lookup variants', () => {
    expect(phoneLookupVariants('14145550100').sort()).toEqual(['14145550100', '4145550100'].sort());
    expect(phoneLookupVariants('4145550100').sort()).toEqual(['14145550100', '4145550100'].sort());
  });

  it('matches the same handset across country-code variants', () => {
    expect(phonesMatch('14145550100', '4145550100')).toBe(true);
    expect(phonesMatch('14145550100', '14145550100')).toBe(true);
    expect(phonesMatch('14145550100', '14145550999')).toBe(false);
  });

  it('canonicalizes 10-digit NANP numbers', () => {
    expect(preferCanonicalPhone('4145550100')).toBe('14145550100');
    expect(preferCanonicalPhone('14145550100')).toBe('14145550100');
  });

  it('validates plausible lengths', () => {
    expect(isPlausiblePhone('14145550100')).toBe(true);
    expect(isPlausiblePhone('123')).toBe(false);
  });
});
