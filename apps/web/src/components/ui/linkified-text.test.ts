import { googleMapsUrl } from './linkified-text';

describe('googleMapsUrl', () => {
  it('prefers coordinates when present', () => {
    expect(
      googleMapsUrl({
        locationName: 'Atwater Elementary School',
        address: '2100 E Capitol Dr, Shorewood, WI 53211',
        latitude: 43.0895,
        longitude: -87.8838,
      }),
    ).toContain('43.0895');
  });

  it('falls back to address search', () => {
    const url = googleMapsUrl({
      locationName: 'Atwater Elementary School',
      address: '2100 E Capitol Dr, Shorewood, WI 53211',
    });
    expect(url).toContain('google.com/maps');
    expect(url).toContain('Atwater');
  });

  it('returns null when nothing to search', () => {
    expect(googleMapsUrl({})).toBeNull();
  });
});
