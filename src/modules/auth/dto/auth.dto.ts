import { z } from 'zod';
import {
  accountRoleSchema,
  calendarDateSchema,
  fullNameSchema,
  genderSchema,
  normalizedPhoneNumberSchema,
} from '../../../common/schemas/profile.schema';

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: 'Email không hợp lệ' })
  .max(254);

const passwordSchema = z
  .string()
  .min(8, { message: 'Mật khẩu phải có ít nhất 8 ký tự' })
  .max(128, { message: 'Mật khẩu không được vượt quá 128 ký tự' });

export const registerSchema = z
  .object({
    email: emailSchema.max(150),
    password: passwordSchema,
    phoneNumber: normalizedPhoneNumberSchema,
    fullName: fullNameSchema,
    gender: genderSchema,
    dateOfBirth: calendarDateSchema.refine(
      (value) => value <= new Date().toISOString().slice(0, 10),
      'Ngày sinh không được ở tương lai',
    ),
    role: accountRoleSchema,
  })
  .strict();

export type RegisterDto = z.infer<typeof registerSchema>;

const loginPasswordSchema = z.string().min(1).max(128);

export const loginSchema = z.union([
  z.object({ email: emailSchema, password: loginPasswordSchema }).strict(),
  z
    .object({
      phoneNumber: normalizedPhoneNumberSchema,
      password: loginPasswordSchema,
    })
    .strict(),
]);

export type LoginDto = z.infer<typeof loginSchema>;

export const refreshTokenSchema = z
  .object({
    refreshToken: z.string().trim().min(1).max(4096),
  })
  .strict();

export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();

export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({ password: passwordSchema })
  .strict();

export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
