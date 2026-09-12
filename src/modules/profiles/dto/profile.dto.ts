import { z } from 'zod';

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Ngày sinh định dạng YYYY-MM-DD' })
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'Ngày sinh không tồn tại');

const timeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, {
    message: 'Thời gian không hợp lệ',
  });

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, { message: 'Số điện thoại không hợp lệ' });

export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100).optional(),
    avatarUrl: z.string().trim().url().max(2048).nullable().optional(),
    dateOfBirth: calendarDateSchema.nullable().optional(),
    gender: z.enum(['male', 'female', 'other']).nullable().optional(),
    phoneNumber: phoneSchema.nullable().optional(),
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
    darkMode: z.boolean().optional(),
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
