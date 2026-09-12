import {
  deviceDataSchema,
  paginatedDevicesSuccessSchema,
  registerDeviceBodySchema,
} from './devices.swagger';

describe('Phase 3 device Swagger schemas', () => {
  it('documents the safe device projection without secrets', () => {
    expect(deviceDataSchema.properties).not.toHaveProperty('fcmToken');
    expect(deviceDataSchema.properties).not.toHaveProperty('installationId');
    expect(deviceDataSchema.properties).not.toHaveProperty('userId');
    expect(deviceDataSchema.properties).toHaveProperty('lastSeenAt');
  });

  it('marks token input write-only and documents pagination', () => {
    expect(registerDeviceBodySchema.properties.fcmToken).toMatchObject({
      writeOnly: true,
    });
    expect(paginatedDevicesSuccessSchema.properties).toHaveProperty(
      'pagination',
    );
  });
});
