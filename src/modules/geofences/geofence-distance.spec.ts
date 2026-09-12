import {
  EARTH_RADIUS_METERS,
  haversineDistanceMeters,
  isPointInsideCircularGeofence,
} from './geofence-distance';

describe('geofence distance', () => {
  it('uses the documented mean Earth radius', () => {
    expect(EARTH_RADIUS_METERS).toBe(6_371_000);
  });

  it('returns zero for identical points and handles coordinate edges', () => {
    expect(haversineDistanceMeters(90, 180, 90, -180)).toBeLessThan(0.001);
    expect(haversineDistanceMeters(-90, -180, -90, 180)).toBeLessThan(0.001);
  });

  it('calculates a known equatorial degree in meters', () => {
    expect(haversineDistanceMeters(0, 0, 0, 1)).toBeCloseTo(111_194.9, 0);
  });

  it('classifies inside and outside points', () => {
    expect(isPointInsideCircularGeofence(0, 0.0005, 0, 0, 100)).toBe(true);
    expect(isPointInsideCircularGeofence(0, 0.002, 0, 0, 100)).toBe(false);
  });

  it('treats the exact boundary as inside', () => {
    const radius = haversineDistanceMeters(10, 106, 10.001, 106);
    expect(isPointInsideCircularGeofence(10.001, 106, 10, 106, radius)).toBe(
      true,
    );
  });
});
