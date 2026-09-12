import {
  phoneCommandDataSchema,
  phoneRuleDataSchema,
  phoneUsageDataSchema,
} from './phone-management.swagger';

describe('Phone Management Swagger contracts', () => {
  it('documents truthful command completion semantics', () => {
    expect(phoneCommandDataSchema.properties.status.description).toContain(
      'only a target-device ACK',
    );
  });

  it('documents policy as intent rather than proven enforcement', () => {
    expect(phoneRuleDataSchema.properties.enforcementStatus).toMatchObject({
      enum: ['device_enforcement_pending'],
    });
  });

  it('contains no transport secrets or surveillance fields', () => {
    for (const schema of [
      phoneUsageDataSchema,
      phoneRuleDataSchema,
      phoneCommandDataSchema,
    ]) {
      for (const field of [
        'fcmToken',
        'installationId',
        'smsContent',
        'contacts',
        'screenContent',
        'keystrokes',
      ]) {
        expect(schema.properties).not.toHaveProperty(field);
      }
    }
  });
});
