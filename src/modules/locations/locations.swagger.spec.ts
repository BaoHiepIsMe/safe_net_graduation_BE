import { LocationsController } from './locations.controller';
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

  it('documents from/to on both history routes', () => {
    const proto = LocationsController.prototype as unknown as Record<
      string,
      object
    >;
    const names = (handler: object) =>
      (
        Reflect.getMetadata('swagger/apiParameters', handler) as {
          name: string;
        }[]
      ).map((item) => item.name);
    const own = names(proto.getOwnHistory);
    const member = names(proto.getFamilyMemberHistory);
    expect(own).toEqual(expect.arrayContaining(['from', 'to']));
    expect(member).toEqual(
      expect.arrayContaining(['familyId', 'memberId', 'from', 'to']),
    );
  });
});
