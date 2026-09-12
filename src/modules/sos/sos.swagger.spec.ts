import {
  createSosContactBodySchema,
  sosEventDataSchema,
  triggerSosBodySchema,
} from './sos.swagger';

describe('Phase 7 SOS Swagger schemas', () => {
  it('documents strict server-derived SOS input', () => {
    expect(triggerSosBodySchema.additionalProperties).toBe(false);
    expect(triggerSosBodySchema.properties).not.toHaveProperty('userId');
    expect(triggerSosBodySchema.properties).not.toHaveProperty('recipientIds');
    expect(triggerSosBodySchema.properties).not.toHaveProperty('status');
  });

  it('documents safe SOS/contact data without device or delivery secrets', () => {
    expect(sosEventDataSchema.properties).not.toHaveProperty('sourceDeviceId');
    expect(sosEventDataSchema.properties).not.toHaveProperty('fcmToken');
    expect(sosEventDataSchema.properties).not.toHaveProperty('deliveries');
    expect(createSosContactBodySchema.properties).not.toHaveProperty(
      'ownerUserId',
    );
  });
});
