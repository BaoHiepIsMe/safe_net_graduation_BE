import {
  createGeofenceSchema,
  geofenceEventQuerySchema,
  replaceGeofenceMembersSchema,
  updateGeofenceSchema,
} from './geofence.dto';

const MEMBER = '11111111-1111-4111-8111-111111111111';
const valid = {
  name: 'Home',
  centerLatitude: 10.7,
  centerLongitude: 106.6,
  radiusMeters: 100,
};

describe('geofence Zod validation', () => {
  it('accepts valid circular geometry and supplies safe defaults', () => {
    expect(createGeofenceSchema.parse(valid)).toMatchObject({ members: [] });
  });

  it.each([
    { centerLatitude: 91 },
    { centerLongitude: -181 },
    { radiusMeters: 0 },
    { radiusMeters: 100001 },
    { centerLatitude: Number.NaN },
    { centerLongitude: Number.POSITIVE_INFINITY },
  ])('rejects invalid geometry %#', (change) => {
    expect(
      createGeofenceSchema.safeParse({ ...valid, ...change }).success,
    ).toBe(false);
  });

  it('rejects unknown client-owned fields and event types', () => {
    expect(
      createGeofenceSchema.safeParse({ ...valid, createdBy: MEMBER }).success,
    ).toBe(false);
    expect(
      createGeofenceSchema.safeParse({ ...valid, eventType: 'enter' }).success,
    ).toBe(false);
    expect(updateGeofenceSchema.safeParse({ familyId: MEMBER }).success).toBe(
      false,
    );
  });

  it('rejects duplicate member assignments', () => {
    expect(
      replaceGeofenceMembersSchema.safeParse({
        members: [{ memberId: MEMBER }, { memberId: MEMBER }],
      }).success,
    ).toBe(false);
  });

  it('requires non-empty allowlisted PATCH input', () => {
    expect(updateGeofenceSchema.safeParse({}).success).toBe(false);
    expect(updateGeofenceSchema.safeParse({ isActive: false }).success).toBe(
      true,
    );
  });

  it('validates bounded event filters and cursor input', () => {
    expect(
      geofenceEventQuerySchema.safeParse({ eventType: 'entered' }).success,
    ).toBe(false);
    expect(geofenceEventQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
    expect(geofenceEventQuerySchema.safeParse({ cursor: '***' }).success).toBe(
      false,
    );
  });
});
