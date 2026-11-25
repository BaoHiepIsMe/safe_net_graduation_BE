import { z } from 'zod';
import {
  DAILY_STATUS_DEFAULT_LIMIT,
  DAILY_STATUS_MAX_LIMIT,
} from '../daily-status.constants';

const uuid = z.string().uuid();

export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, 'Invalid local date');

export const dailyStatusParamSchema = z.object({ reportId: uuid }).strict();

export const dailyStatusMemberParamSchema = z
  .object({ familyId: uuid, memberId: uuid })
  .strict();

export const dailyStatusHistoryQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(DAILY_STATUS_MAX_LIMIT)
      .default(DAILY_STATUS_DEFAULT_LIMIT),
    cursor: z.string().max(500).optional(),
  })
  .strict();

const availabilitySchema = z.enum(['available', 'no_data']);
const nonnegativeInteger = z.number().int().nonnegative();

export const dailyStatusSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    availability: z
      .object({
        location: availabilitySchema,
        geofence: availabilitySchema,
        sos: availabilitySchema,
        reminders: availabilitySchema,
        phoneUsage: z.enum(['available', 'no_data', 'not_applicable']),
      })
      .strict(),
    location: z
      .object({
        recordCount: nonnegativeInteger,
        lastRecordedAt: z.iso.datetime({ offset: true }).nullable(),
      })
      .strict(),
    geofence: z
      .object({ enterCount: nonnegativeInteger, exitCount: nonnegativeInteger })
      .strict(),
    sos: z
      .object({
        totalCount: nonnegativeInteger,
        activeCount: nonnegativeInteger,
        resolvedCount: nonnegativeInteger,
        cancelledCount: nonnegativeInteger,
      })
      .strict(),
    reminders: z
      .object({
        occurrenceCount: nonnegativeInteger,
        notificationProcessedCount: nonnegativeInteger,
        missedCount: nonnegativeInteger,
        // Absent in summaries stored before reminders could be completed.
        completedCount: nonnegativeInteger.optional(),
      })
      .strict(),
    phoneUsage: z
      .object({
        totalUsageSeconds: nonnegativeInteger,
        topApps: z
          .array(
            z
              .object({
                appPackage: z.string().min(1).max(150),
                appName: z.string().min(1).max(100).nullable(),
                durationSeconds: nonnegativeInteger,
              })
              .strict(),
          )
          .max(5),
      })
      .strict(),
  })
  .strict();

export type DailyStatusParam = z.infer<typeof dailyStatusParamSchema>;
export type DailyStatusMemberParam = z.infer<
  typeof dailyStatusMemberParamSchema
>;
export type DailyStatusHistoryQueryDto = z.infer<
  typeof dailyStatusHistoryQuerySchema
>;
export type DailyStatusSummary = z.infer<typeof dailyStatusSummarySchema>;
export type DailyStatusCursor = { reportDate: Date; id: string };
