import { z } from 'zod';

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

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, { message: 'Số điện thoại không hợp lệ' });

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    fullName: z
      .string()
      .trim()
      .min(2, { message: 'Họ và tên phải có ít nhất 2 ký tự' })
      .max(100),
    phoneNumber: phoneSchema.optional(),
  })
  .strict();

export type RegisterDto = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
  })
  .strict();

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
