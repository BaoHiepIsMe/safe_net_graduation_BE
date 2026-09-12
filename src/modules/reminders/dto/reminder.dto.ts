import { z } from 'zod';
import {
  REMINDER_DEFAULT_LIMIT,
  REMINDER_MAX_LIMIT,
  REMINDER_UPCOMING_MAX_DAYS,
} from '../reminders.constants';

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const uuid = z.string().uuid();
const timezone = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA timezone');
const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) => {
      const [year, month, day] = value.split('-').map(Number);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      return (
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day
      );
    },
    { message: 'Invalid local date' },
  );
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const offsetDateTime = z.iso.datetime({ offset: true });

const onceScheduleSchema = z
  .object({
    type: z.literal('once'),
    occurrenceAt: offsetDateTime,
    timezone,
  })
  .strict();

const dailyScheduleSchema = z
  .object({
    type: z.literal('daily'),
    timeOfDay,
    timezone,
    startsOn: localDate,
    endsAt: offsetDateTime.optional(),
  })
  .strict();

const weeklyScheduleSchema = z
  .object({
    type: z.literal('weekly'),
    timeOfDay,
    timezone,
    startsOn: localDate,
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    endsAt: offsetDateTime.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.weekdays).size !== value.weekdays.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['weekdays'],
        message: 'Weekdays must be unique',
      });
    }
  });

export const reminderScheduleSchema = z.discriminatedUnion('type', [
  onceScheduleSchema,
  dailyScheduleSchema,
  weeklyScheduleSchema,
]);

export const createReminderSchema = z
  .object({
    familyId: uuid,
    title: trimmed(150),
    description: z.string().trim().max(2000).nullable().optional(),
    reminderType: trimmed(30).nullable().optional(),
    schedule: reminderScheduleSchema,
    targetMemberIds: z.array(uuid).min(1).max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.targetMemberIds).size !== value.targetMemberIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetMemberIds'],
        message: 'Target members must be unique',
      });
    }
  });

export const updateReminderSchema = z
  .object({
    title: trimmed(150).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    reminderType: trimmed(30).nullable().optional(),
    schedule: reminderScheduleSchema.optional(),
    targetMemberIds: z.array(uuid).min(1).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'At least one field is required',
      });
    }
    if (
      value.targetMemberIds &&
      new Set(value.targetMemberIds).size !== value.targetMemberIds.length
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetMemberIds'],
        message: 'Target members must be unique',
      });
    }
  });

export const reminderParamSchema = z.object({ reminderId: uuid }).strict();

export const reminderListQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(REMINDER_MAX_LIMIT)
      .default(REMINDER_DEFAULT_LIMIT),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(256)
      .optional(),
    active: z.enum(['true', 'false']).optional(),
  })
  .strict();

export const reminderLogQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(REMINDER_MAX_LIMIT)
      .default(REMINDER_DEFAULT_LIMIT),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(256)
      .optional(),
  })
  .strict();

export const upcomingReminderQuerySchema = z
  .object({
    days: z.coerce
      .number()
      .int()
      .min(1)
      .max(REMINDER_UPCOMING_MAX_DAYS)
      .default(7),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(REMINDER_MAX_LIMIT)
      .default(REMINDER_DEFAULT_LIMIT),
  })
  .strict();

export type ReminderScheduleDto = z.infer<typeof reminderScheduleSchema>;
export type CreateReminderDto = z.infer<typeof createReminderSchema>;
export type UpdateReminderDto = z.infer<typeof updateReminderSchema>;
export type ReminderParam = z.infer<typeof reminderParamSchema>;
export type ReminderListQueryDto = z.infer<typeof reminderListQuerySchema>;
export type ReminderLogQueryDto = z.infer<typeof reminderLogQuerySchema>;
export type UpcomingReminderQueryDto = z.infer<
  typeof upcomingReminderQuerySchema
>;

export interface ReminderCursor {
  createdAt: Date;
  id: string;
}

export interface ReminderLogCursor {
  scheduledAt: Date;
  id: string;
}
