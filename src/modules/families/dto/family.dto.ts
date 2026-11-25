import { z } from 'zod';
import { pagePaginationSchema } from '../../../common/dto/pagination.dto';
import { FAMILY_LABELS } from '../families.constants';

const familyNameSchema = z.string().trim().min(2).max(100);
const displayNameSchema = z.string().trim().min(1).max(100);
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, 'Số điện thoại không hợp lệ');
const careScopeMemberIdsSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(50)
  .transform((ids) => [...new Set(ids)]);

export const familyIdParamSchema = z
  .object({ familyId: z.string().uuid() })
  .strict();

export const familyMemberParamSchema = z
  .object({
    familyId: z.string().uuid(),
    memberId: z.string().uuid(),
  })
  .strict();

export const memberIdParamSchema = z
  .object({ memberId: z.string().uuid() })
  .strict();

export const invitationIdParamSchema = z
  .object({ invitationId: z.string().uuid() })
  .strict();

export const familyInvitationParamSchema = z
  .object({
    familyId: z.string().uuid(),
    invitationId: z.string().uuid(),
  })
  .strict();

export const familyPaginationSchema = pagePaginationSchema.strict();

export const joinPreviewQuerySchema = z
  .object({
    code: z.string().trim().min(1).max(20),
  })
  .strict();

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
    displayName: displayNameSchema.optional(),
    canManageCare: z.boolean().optional(),
    isCareRecipient: z.boolean().optional(),
    careScopeMemberIds: careScopeMemberIdsSchema.optional(),
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
    if (
      value.familyLabel === 'caregiver' &&
      (!value.careScopeMemberIds || value.careScopeMemberIds.length === 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['careScopeMemberIds'],
        message:
          'Nhãn người chăm sóc thuê bắt buộc phải chọn ít nhất một người được chăm sóc',
      });
    }
    if (
      value.familyLabel !== 'caregiver' &&
      value.careScopeMemberIds &&
      value.careScopeMemberIds.length > 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['careScopeMemberIds'],
        message: 'Chỉ người chăm sóc thuê mới có phạm vi chăm sóc',
      });
    }
  });

export const joinFamilySchema = z
  .object({
    // Normalised (trim + upper-case) in the service; a wrong code is a 404, not a 400.
    code: z.string().trim().min(1).max(20),
    familyLabel: z.enum(FAMILY_LABELS),
    displayName: displayNameSchema.optional(),
  })
  .strict();

export const approveJoinRequestSchema = z
  .object({
    familyLabel: z.enum(FAMILY_LABELS).optional(),
    displayName: displayNameSchema.nullable().optional(),
    canManageCare: z.boolean().optional(),
    isCareRecipient: z.boolean().optional(),
    careScopeMemberIds: careScopeMemberIdsSchema.optional(),
  })
  .strict();

export const transferOwnershipSchema = z
  .object({ memberId: z.string().uuid() })
  .strict();

export const updateFamilyMemberSchema = z
  .object({
    familyLabel: z.enum(FAMILY_LABELS).optional(),
    displayName: displayNameSchema.nullable().optional(),
    canManageCare: z.boolean().optional(),
    isCareRecipient: z.boolean().optional(),
    careScopeMemberIds: careScopeMemberIdsSchema.optional(),
    locationSharingEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Cần cung cấp ít nhất một trường để cập nhật',
  });

export type FamilyIdParam = z.infer<typeof familyIdParamSchema>;
export type FamilyMemberParam = z.infer<typeof familyMemberParamSchema>;
export type MemberIdParam = z.infer<typeof memberIdParamSchema>;
export type FamilyInvitationParam = z.infer<typeof familyInvitationParamSchema>;
export type JoinPreviewQueryDto = z.infer<typeof joinPreviewQuerySchema>;
export type JoinFamilyDto = z.infer<typeof joinFamilySchema>;
export type ApproveJoinRequestDto = z.infer<typeof approveJoinRequestSchema>;
export type TransferOwnershipDto = z.infer<typeof transferOwnershipSchema>;
export type InvitationIdParam = z.infer<typeof invitationIdParamSchema>;
export type FamilyPaginationDto = z.infer<typeof familyPaginationSchema>;
export type CreateFamilyDto = z.infer<typeof createFamilySchema>;
export type UpdateFamilyDto = z.infer<typeof updateFamilySchema>;
export type CreateInvitationDto = z.infer<typeof createInvitationSchema>;
export type UpdateFamilyMemberDto = z.infer<typeof updateFamilyMemberSchema>;
