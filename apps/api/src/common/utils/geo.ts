const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two coordinates in kilometers (haversine). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * SQL fragment computing haversine distance in km for use in raw queries.
 * Columns must be named `latitude` / `longitude`. Parameters are injected
 * as numbers by the caller — never interpolate user strings here.
 */
export function haversineSql(latParam: string, lonParam: string): string {
  return `(2 * ${EARTH_RADIUS_KM} * asin(sqrt(
    power(sin(radians((latitude - ${latParam}) / 2)), 2) +
    cos(radians(${latParam})) * cos(radians(latitude)) *
    power(sin(radians((longitude - ${lonParam}) / 2)), 2)
  )))`;
}
