import { z } from 'zod';
import {
  PHONE_ACK_STATUSES,
  PHONE_COMMAND_STATUSES,
  PHONE_DEFAULT_LIMIT,
  PHONE_MAX_HISTORY_DAYS,
  PHONE_MAX_LIMIT,
} from '../phone-management.constants';

const uuid = z.string().uuid();
const isoDateTime = z.iso.datetime({ offset: true });
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const cursor = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .max(256)
  .optional();
const limit = z.coerce
  .number()
  .int()
  .min(1)
  .max(PHONE_MAX_LIMIT)
  .default(PHONE_DEFAULT_LIMIT);

export const familyMemberParamSchema = z
  .object({ familyId: uuid, memberId: uuid })
  .strict();
export const familyMemberDeviceParamSchema = z
  .object({ familyId: uuid, memberId: uuid, deviceId: uuid })
  .strict();
export const phoneRuleParamSchema = z
  .object({ familyId: uuid, memberId: uuid, ruleId: uuid })
  .strict();
export const deviceParamSchema = z.object({ deviceId: uuid }).strict();
export const deviceCommandParamSchema = z
  .object({ deviceId: uuid, commandId: uuid })
  .strict();

export const phoneUsageSchema = z
  .object({
    clientRecordId: uuid,
    appPackage: z
      .string()
      .trim()
      .min(1)
      .max(150)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    appName: z.string().trim().min(1).max(100).optional(),
    startedAt: isoDateTime,
    endedAt: isoDateTime,
    durationSeconds: z.number().int().min(0).max(86400),
  })
  .strict()
  .superRefine((value, context) => {
    const startedAt = new Date(value.startedAt);
    const endedAt = new Date(value.endedAt);
    if (startedAt > endedAt) {
      context.addIssue({
        code: 'custom',
        path: ['endedAt'],
        message: 'endedAt must not be before startedAt',
      });
    }
    const elapsed = Math.round(
      (endedAt.getTime() - startedAt.getTime()) / 1000,
    );
    if (elapsed >= 0 && value.durationSeconds > elapsed) {
      context.addIssue({
        code: 'custom',
        path: ['durationSeconds'],
        message: 'durationSeconds must not exceed the reported time window',
      });
    }
  });

export const usageListQuerySchema = z
  .object({
    limit,
    cursor,
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.from || !value.to) return;
    const from = new Date(value.from);
    const to = new Date(value.to);
    if (from > to) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'to must follow from',
      });
    }
    if (to.getTime() - from.getTime() > PHONE_MAX_HISTORY_DAYS * 86400000) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: `Date range cannot exceed ${PHONE_MAX_HISTORY_DAYS} days`,
      });
    }
  });

const ruleFields = {
  dailyLimitMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  bedtimeStart: timeOfDay.nullable().optional(),
  bedtimeEnd: timeOfDay.nullable().optional(),
};

function validateBedtimePair(
  value: { bedtimeStart?: string | null; bedtimeEnd?: string | null },
  context: z.RefinementCtx,
) {
  const hasStart = value.bedtimeStart !== undefined;
  const hasEnd = value.bedtimeEnd !== undefined;
  if (
    hasStart !== hasEnd ||
    (hasStart && (value.bedtimeStart === null) !== (value.bedtimeEnd === null))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['bedtimeEnd'],
      message:
        'bedtimeStart and bedtimeEnd must be supplied or cleared together',
    });
  }
}

export const createPhoneRuleSchema = z
  .object(ruleFields)
  .strict()
  .superRefine((value, context) => {
    validateBedtimePair(value, context);
    if (value.dailyLimitMinutes == null && value.bedtimeStart == null) {
      context.addIssue({
        code: 'custom',
        message: 'A daily limit or bedtime window is required',
      });
    }
  });

export const updatePhoneRuleSchema = z
  .object({ ...ruleFields, isActive: z.boolean().optional() })
  .strict()
  .superRefine((value, context) => {
    validateBedtimePair(value, context);
    if (Object.keys(value).length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'At least one field is required',
      });
    }
  });

const commandBase = { clientRequestId: uuid };
export const createPhoneCommandSchema = z.discriminatedUnion('commandType', [
  z.object({ ...commandBase, commandType: z.literal('lock') }).strict(),
  z.object({ ...commandBase, commandType: z.literal('unlock') }).strict(),
  z.object({ ...commandBase, commandType: z.literal('ring') }).strict(),
  z
    .object({
      ...commandBase,
      commandType: z.literal('warning'),
      message: z.string().trim().min(1).max(200),
    })
    .strict(),
]);

export const commandAckSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal(PHONE_ACK_STATUSES[0]),
      resultCode: z.string().trim().min(1).max(50).optional(),
      message: z.string().trim().min(1).max(300).optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal(PHONE_ACK_STATUSES[1]),
      resultCode: z.string().trim().min(1).max(50),
      message: z.string().trim().min(1).max(300).optional(),
    })
    .strict(),
]);

export const commandListQuerySchema = z
  .object({
    limit,
    cursor,
    status: z.enum([...PHONE_COMMAND_STATUSES, 'all']).default('all'),
  })
  .strict();

export type FamilyMemberParam = z.infer<typeof familyMemberParamSchema>;
export type FamilyMemberDeviceParam = z.infer<
  typeof familyMemberDeviceParamSchema
>;
export type PhoneRuleParam = z.infer<typeof phoneRuleParamSchema>;
export type DeviceParam = z.infer<typeof deviceParamSchema>;
export type DeviceCommandParam = z.infer<typeof deviceCommandParamSchema>;
export type PhoneUsageDto = z.infer<typeof phoneUsageSchema>;
export type UsageListQueryDto = z.infer<typeof usageListQuerySchema>;
export type CreatePhoneRuleDto = z.infer<typeof createPhoneRuleSchema>;
export type UpdatePhoneRuleDto = z.infer<typeof updatePhoneRuleSchema>;
export type CreatePhoneCommandDto = z.infer<typeof createPhoneCommandSchema>;
export type CommandAckDto = z.infer<typeof commandAckSchema>;
export type CommandListQueryDto = z.infer<typeof commandListQuerySchema>;

export interface PhoneCursor {
  createdAt: Date;
  id: string;
}
