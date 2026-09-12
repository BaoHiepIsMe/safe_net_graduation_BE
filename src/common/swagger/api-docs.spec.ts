import {
  biometricDataSchema,
  livenessDataSchema,
  loginSuccessDataSchema,
  profileDataSchema,
  readinessDataSchema,
  refreshSuccessDataSchema,
  registerSuccessDataSchema,
  settingsDataSchema,
} from './api-docs';

describe('Phase 0 and Phase 1 Swagger success schemas', () => {
  it.each([
    ['register', registerSuccessDataSchema, ['user', 'session']],
    ['login', loginSuccessDataSchema, ['user', 'session']],
    ['refresh', refreshSuccessDataSchema, ['session']],
    ['profile', profileDataSchema, ['id', 'fullName', 'accountStatus']],
    ['settings', settingsDataSchema, ['userId', 'language']],
    ['biometrics', biometricDataSchema, ['userId', 'biometricEnabled']],
    ['liveness', livenessDataSchema, ['status', 'uptime']],
    ['readiness', readinessDataSchema, ['status', 'dependencies']],
  ])('documents concrete %s fields', (_name, schema, fields) => {
    expect(schema.type).toBe('object');
    expect(schema.properties).toEqual(
      expect.objectContaining(
        Object.fromEntries(fields.map((field) => [field, expect.any(Object)])),
      ),
    );
  });
});
