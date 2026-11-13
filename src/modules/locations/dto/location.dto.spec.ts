import {
  ingestLocationSchema,
  locationDeviceParamSchema,
  locationHistoryQuerySchema,
} from './location.dto';

const valid = {
  latitude: 10.7769,
  longitude: 106.7009,
  accuracy: 5,
  speed: 0,
  heading: 120,
  batteryLevel: 80,
  recordedAt: new Date().toISOString(),
};

describe('location request validation', () => {
  it('accepts finite supported location metadata', () => {
    const parsed = ingestLocationSchema.parse(valid);
    expect(parsed.recordedAt).toBeInstanceOf(Date);
  });

  it.each([
    [{ ...valid, latitude: -91 }],
    [{ ...valid, latitude: 91 }],
    [{ ...valid, longitude: -181 }],
    [{ ...valid, longitude: 181 }],
    [{ ...valid, accuracy: -1 }],
    [{ ...valid, speed: -1 }],
    [{ ...valid, heading: 360 }],
    [{ ...valid, latitude: Number.NaN }],
    [{ ...valid, longitude: Number.POSITIVE_INFINITY }],
  ])('rejects invalid numeric location input', (input) => {
    expect(ingestLocationSchema.safeParse(input).success).toBe(false);
  });

  it('rejects unreasonable future capture timestamps', () => {
    expect(
      ingestLocationSchema.safeParse({
        ...valid,
        recordedAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      }).success,
    ).toBe(false);
  });

  it('rejects ownership, server timestamps, location identity and unknown fields', () => {
    expect(
      ingestLocationSchema.safeParse({
        ...valid,
        userId: '11111111-1111-4111-8111-111111111111',
        memberId: '22222222-2222-4222-8222-222222222222',
        createdAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });

  it('validates device UUID and bounded history pagination', () => {
    expect(
      locationDeviceParamSchema.safeParse({ deviceId: 'not-a-uuid' }).success,
    ).toBe(false);
    expect(locationHistoryQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
    expect(locationHistoryQuerySchema.parse({}).limit).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('accepts history queries with or without from/to', () => {
    expect(locationHistoryQuerySchema.parse({}).limit).toBe(50);
    const parsed = locationHistoryQuerySchema.parse({
      from: '2026-08-24T00:00:00+07:00',
      to: '2026-08-25T00:00:00+07:00',
    });
    expect(parsed.from).toBeInstanceOf(Date);
    expect(parsed.to).toBeInstanceOf(Date);
  });

  it.each([
    [{ from: '2026-08-25T00:00:00Z', to: '2026-08-24T00:00:00Z' }],
    [{ from: '2026-08-24T00:00:00Z', to: '2026-08-24T00:00:00Z' }],
    [{ from: 'yesterday' }],
    [{ to: '2026-08-24' }],
  ])('rejects invalid history range %j', (input) => {
    expect(locationHistoryQuerySchema.safeParse(input).success).toBe(false);
  });
});
