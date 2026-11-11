import {
  updateBiometricSettingsSchema,
  updateProfileSchema,
  updateUserSettingsSchema,
} from './profile.dto';

describe('profile request schemas', () => {
  it('rejects impossible calendar dates', () => {
    expect(() =>
      updateProfileSchema.parse({ dateOfBirth: '2025-02-30' }),
    ).toThrow();
  });

  it('rejects impossible quiet-hour values', () => {
    expect(() =>
      updateUserSettingsSchema.parse({ quietHoursStart: '99:99' }),
    ).toThrow();
  });

  it('requires a concrete biometric type when enabled', () => {
    expect(() =>
      updateBiometricSettingsSchema.parse({ biometricEnabled: true }),
    ).toThrow();
  });

  it('rejects mass-assignment fields', () => {
    expect(() =>
      updateProfileSchema.parse({ accountStatus: 'active' }),
    ).toThrow();
    expect(() => updateProfileSchema.parse({ role: 'parent' })).toThrow();
  });
});
