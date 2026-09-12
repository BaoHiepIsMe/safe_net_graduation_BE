import {
  cameraListQuerySchema,
  cameraParamSchema,
  createCameraSchema,
  updateCameraSchema,
} from './camera.dto';

const id = '11111111-1111-4111-8111-111111111111';

describe('Camera DTO validation', () => {
  it('accepts trimmed safe metadata and approved write-only URL schemes', () => {
    expect(
      createCameraSchema.parse({
        name: '  Front door  ',
        locationLabel: ' Entrance ',
        connectionUrl: 'rtsps://camera.example.invalid/live',
      }),
    ).toMatchObject({ name: 'Front door', locationLabel: 'Entrance' });
    expect(
      updateCameraSchema.parse({
        connectionUrl: 'https://camera.example.invalid/config',
      }),
    ).toBeDefined();
  });

  it('rejects file, data, ftp and malformed connection URLs', () => {
    for (const connectionUrl of [
      'file:///etc/passwd',
      'data:text/plain,test',
      'ftp://camera.invalid/live',
      'not-a-url',
    ]) {
      expect(
        createCameraSchema.safeParse({ name: 'Camera', connectionUrl }).success,
      ).toBe(false);
    }
  });

  it('rejects ownership, connectivity, AI and server-state spoofing', () => {
    for (const field of [
      'familyId',
      'createdBy',
      'ownerUserId',
      'lastOnlineAt',
      'isOnline',
      'connectionStatus',
      'fallDetectionEnabled',
      'confidence',
      'createdAt',
    ]) {
      expect(
        createCameraSchema.safeParse({ name: 'Camera', [field]: id }).success,
      ).toBe(false);
    }
  });

  it('requires strict non-empty update and valid UUID parameters', () => {
    expect(updateCameraSchema.safeParse({}).success).toBe(false);
    expect(
      updateCameraSchema.safeParse({ name: 'Updated', status: 'online' })
        .success,
    ).toBe(false);
    expect(
      cameraParamSchema.safeParse({ familyId: id, cameraId: id }).success,
    ).toBe(true);
    expect(
      cameraParamSchema.safeParse({ familyId: id, cameraId: 'bad' }).success,
    ).toBe(false);
  });

  it('bounds pagination and defaults to active cameras', () => {
    expect(cameraListQuerySchema.parse({})).toEqual({
      limit: 20,
      active: 'true',
    });
    expect(cameraListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(cameraListQuerySchema.safeParse({ ownerId: id }).success).toBe(
      false,
    );
  });
});
