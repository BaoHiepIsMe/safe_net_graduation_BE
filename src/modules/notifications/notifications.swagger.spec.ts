import {
  emptyMutationBodySchema,
  notificationDataSchema,
  notificationListSuccessSchema,
} from './notifications.swagger';

describe('Phase 6 notification Swagger schemas', () => {
  it('documents only the safe notification projection', () => {
    expect(notificationDataSchema.properties).not.toHaveProperty(
      'recipientUserId',
    );
    expect(notificationDataSchema.properties).not.toHaveProperty('fcmToken');
    expect(notificationDataSchema.properties).not.toHaveProperty('deliveries');
    expect(notificationDataSchema.properties).not.toHaveProperty(
      'errorCategory',
    );
    expect(notificationDataSchema.properties).toHaveProperty('metadata');
  });

  it('documents cursor pagination and strict empty mutation bodies', () => {
    expect(notificationListSuccessSchema.properties).toHaveProperty(
      'pagination',
    );
    expect(emptyMutationBodySchema).toMatchObject({
      additionalProperties: false,
      maxProperties: 0,
    });
  });
});
