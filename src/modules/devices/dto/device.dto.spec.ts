import {
  deviceHeartbeatSchema,
  deviceIdParamSchema,
  registerDeviceSchema,
  updateDeviceSchema,
} from './device.dto';

const installationId = '11111111-1111-4111-8111-111111111111';

describe('device request validation', () => {
  it('accepts a valid registration and trims metadata', () => {
    const parsed = registerDeviceSchema.parse({
      installationId,
      deviceName: '  Điện thoại A  ',
      platform: 'android',
      fcmToken: 'valid-fcm-token-value',
      batteryLevel: 75,
    });
    expect(parsed.deviceName).toBe('Điện thoại A');
  });

  it('rejects malformed IDs, platforms and battery values', () => {
    expect(
      registerDeviceSchema.safeParse({
        installationId: 'not-a-uuid',
        platform: 'windows-phone',
        batteryLevel: 101,
      }).success,
    ).toBe(false);
    expect(deviceIdParamSchema.safeParse({ deviceId: 'bad' }).success).toBe(
      false,
    );
    expect(
      registerDeviceSchema.safeParse({
        installationId,
        platform: 'android',
        fcmToken: 'invalid token with spaces',
      }).success,
    ).toBe(false);
  });

  it('rejects impersonation, mass assignment and unknown fields', () => {
    expect(
      registerDeviceSchema.safeParse({
        installationId,
        platform: 'ios',
        userId: '22222222-2222-4222-8222-222222222222',
      }).success,
    ).toBe(false);
    expect(
      updateDeviceSchema.safeParse({ isActive: true, createdAt: new Date() })
        .success,
    ).toBe(false);
  });

  it('keeps heartbeat server-controlled and excludes location', () => {
    expect(deviceHeartbeatSchema.safeParse({ batteryLevel: 20 }).success).toBe(
      true,
    );
    expect(
      deviceHeartbeatSchema.safeParse({
        lastSeenAt: new Date().toISOString(),
        latitude: 10.7,
        longitude: 106.6,
      }).success,
    ).toBe(false);
  });
});
