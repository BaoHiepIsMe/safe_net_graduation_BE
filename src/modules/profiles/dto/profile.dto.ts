import { z } from 'zod';
import {
  calendarDateSchema,
  fullNameSchema,
  genderSchema,
} from '../../../common/schemas/profile.schema';

const timeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, {
    message: 'Thời gian không hợp lệ',
  });

export const updateProfileSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    avatarUrl: z.string().trim().url().max(2048).nullable().optional(),
    dateOfBirth: calendarDateSchema.nullable().optional(),
    gender: genderSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Cần cung cấp ít nhất một trường để cập nhật',
  });

export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

export const updateUserSettingsSchema = z
  .object({
    language: z.enum(['vi', 'en']).optional(),
    pushNotificationsEnabled: z.boolean().optional(),
    smsNotificationsEnabled: z.boolean().optional(),
    emailNotificationsEnabled: z.boolean().optional(),
    locationSharingEnabled: z.boolean().optional(),
    sharingMode: z.enum(['continuous', 'battery_saver']).optional(),
    locationVisibility: z.enum(['all', 'selected']).optional(),
    notifyOnZoneExit: z.boolean().optional(),
    notifyOnSignalLost: z.boolean().optional(),
    darkMode: z.boolean().optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
    quietHoursStart: timeSchema.nullable().optional(),
    quietHoursEnd: timeSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Cần cung cấp ít nhất một trường để cập nhật',
  });

export type UpdateUserSettingsDto = z.infer<typeof updateUserSettingsSchema>;

export const updateBiometricSettingsSchema = z
  .object({
    biometricEnabled: z.boolean(),
    biometricType: z.enum(['fingerprint', 'face', 'iris', 'none']).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.biometricEnabled &&
      (!value.biometricType || value.biometricType === 'none')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['biometricType'],
        message: 'Phải chọn loại sinh trắc học khi bật tính năng',
      });
    }
  });

export type UpdateBiometricSettingsDto = z.infer<
  typeof updateBiometricSettingsSchema
>;
