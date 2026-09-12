import {
  cameraDataSchema,
  createCameraBodySchema,
  updateCameraBodySchema,
} from './cameras.swagger';

describe('Camera Swagger contracts', () => {
  it('documents connection configuration as write-only', () => {
    expect(createCameraBodySchema.properties).toHaveProperty('connectionUrl');
    expect(updateCameraBodySchema.properties).toHaveProperty('connectionUrl');
    expect(cameraDataSchema.properties).not.toHaveProperty('connectionUrl');
    expect(cameraDataSchema.properties).not.toHaveProperty('streamUrl');
  });

  it('exposes only truthful safe metadata and no credentials or AI fields', () => {
    expect(cameraDataSchema.properties).toHaveProperty('connectivityStatus', {
      type: 'string',
      enum: ['unknown'],
    });
    for (const field of [
      'password',
      'token',
      'credentials',
      'lastOnlineAt',
      'isOnline',
      'fallDetectionEnabled',
      'aiResult',
    ]) {
      expect(cameraDataSchema.properties).not.toHaveProperty(field);
    }
  });
});
