import { z } from 'zod';
import { pagePaginationSchema } from '../../../common/dto/pagination.dto';
import {
  FAMILY_LABELS,
  FAMILY_ROLES,
  INVITABLE_FAMILY_ROLES,
} from '../families.constants';

const familyNameSchema = z.string().trim().min(2).max(100);
const displayNameSchema = z.string().trim().min(1).max(100);
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, 'Số điện thoại không hợp lệ');

export const familyIdParamSchema = z
  .object({ familyId: z.string().uuid() })
  .strict();

export const familyMemberParamSchema = z
  .object({
    familyId: z.string().uuid(),
    memberId: z.string().uuid(),
  })
  .strict();

export const invitationIdParamSchema = z
  .object({ invitationId: z.string().uuid() })
  .strict();

export const familyPaginationSchema = pagePaginationSchema.strict();

export const createFamilySchema = z
  .object({
    familyName: familyNameSchema,
    avatarUrl: z.string().trim().url().max(2048).nullable().optional(),
    familyLabel: z.enum(FAMILY_LABELS),
    displayName: displayNameSchema.optional(),
  })
  .strict();

export const updateFamilySchema = z
  .object({
    familyName: familyNameSchema.optional(),
    avatarUrl: z.string().trim().url().max(2048).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Cần cung cấp ít nhất một trường để cập nhật',
  });

export const createInvitationSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(150).optional(),
    phoneNumber: phoneSchema.optional(),
    familyLabel: z.enum(FAMILY_LABELS),
    role: z.enum(INVITABLE_FAMILY_ROLES).default(INVITABLE_FAMILY_ROLES[0]),
    displayName: displayNameSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Boolean(value.email) === Boolean(value.phoneNumber)) {
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Cung cấp chính xác một email hoặc số điện thoại',
      });
    }
  });

export const updateFamilyMemberSchema = z
  .object({
    role: z.enum(FAMILY_ROLES).optional(),
    familyLabel: z.enum(FAMILY_LABELS).optional(),
    displayName: displayNameSchema.nullable().optional(),
    locationSharingEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Cần cung cấp ít nhất một trường để cập nhật',
  });

export type FamilyIdParam = z.infer<typeof familyIdParamSchema>;
export type FamilyMemberParam = z.infer<typeof familyMemberParamSchema>;
export type InvitationIdParam = z.infer<typeof invitationIdParamSchema>;
export type FamilyPaginationDto = z.infer<typeof familyPaginationSchema>;
export type CreateFamilyDto = z.infer<typeof createFamilySchema>;
export type UpdateFamilyDto = z.infer<typeof updateFamilySchema>;
export type CreateInvitationDto = z.infer<typeof createInvitationSchema>;
export type UpdateFamilyMemberDto = z.infer<typeof updateFamilyMemberSchema>;
