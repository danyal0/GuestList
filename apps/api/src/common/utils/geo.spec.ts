import { haversineKm, haversineSql } from './geo';

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm(37.7749, -122.4194, 37.7749, -122.4194)).toBe(0);
  });

  it('computes the SF ↔ LA distance within tolerance (~559 km)', () => {
    const distance = haversineKm(37.7749, -122.4194, 34.0522, -118.2437);
    expect(distance).toBeGreaterThan(540);
    expect(distance).toBeLessThan(580);
  });

  it('is symmetric', () => {
    const ab = haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
    const ba = haversineKm(48.8566, 2.3522, 51.5074, -0.1278);
    expect(ab).toBeCloseTo(ba, 10);
  });

  it('handles antipodal points without NaN (asin clamp)', () => {
    const distance = haversineKm(0, 0, 0, 180);
    expect(Number.isFinite(distance)).toBe(true);
    // Half the Earth's circumference ≈ 20015 km.
    expect(distance).toBeGreaterThan(19000);
  });
});

describe('haversineSql', () => {
  it('embeds the given parameter placeholders and no user data', () => {
    const sql = haversineSql('$1', '$2');
    expect(sql).toContain('$1');
    expect(sql).toContain('$2');
    expect(sql).toContain('latitude');
    expect(sql).toContain('longitude');
  });
});
