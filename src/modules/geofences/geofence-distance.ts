export const EARTH_RADIUS_METERS = 6_371_000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function haversineDistanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const latitudeDelta = toRadians(latitudeB - latitudeA);
  const longitudeDelta = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isPointInsideCircularGeofence(
  pointLatitude: number,
  pointLongitude: number,
  centerLatitude: number,
  centerLongitude: number,
  radiusMeters: number,
): boolean {
  return (
    haversineDistanceMeters(
      pointLatitude,
      pointLongitude,
      centerLatitude,
      centerLongitude,
    ) <= radiusMeters
  );
}
