import {
  currentLocationDataSchema,
  ingestLocationBodySchema,
  locationHistorySuccessSchema,
} from './locations.swagger';

describe('Phase 4 location Swagger schemas', () => {
  it('documents strict ingestion without ownership or secret fields', () => {
    expect(ingestLocationBodySchema.additionalProperties).toBe(false);
    expect(ingestLocationBodySchema.properties).not.toHaveProperty('userId');
    expect(ingestLocationBodySchema.properties).not.toHaveProperty('memberId');
    expect(ingestLocationBodySchema.properties).not.toHaveProperty('fcmToken');
  });

  it('keeps current location and cursor responses secret-free', () => {
    expect(currentLocationDataSchema.properties).not.toHaveProperty('deviceId');
    expect(currentLocationDataSchema.properties).not.toHaveProperty(
      'installationId',
    );
    expect(locationHistorySuccessSchema.properties).toHaveProperty(
      'pagination',
    );
  });
});
