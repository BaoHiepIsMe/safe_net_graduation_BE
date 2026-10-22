import { z } from 'zod';

export const calendarDateSchema = z.iso
  .date({ message: 'Ngày sinh phải là ngày tồn tại, định dạng YYYY-MM-DD' })
  .refine((value) => !value.startsWith('0000-'), 'Năm sinh không hợp lệ');

export const genderSchema = z.enum(['male', 'female', 'other']);

export const fullNameSchema = z.string().trim().min(2).max(100);

export const phoneNumberSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, { message: 'Số điện thoại không hợp lệ' });

export const normalizedPhoneNumberSchema = phoneNumberSchema.transform(
  (value) => (value.startsWith('+') ? value : `+${value}`),
);
