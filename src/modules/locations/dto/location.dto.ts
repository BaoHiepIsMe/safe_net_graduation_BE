import { z } from 'zod';
import {
  LOCATION_FUTURE_TOLERANCE_MS,
  LOCATION_HISTORY_DEFAULT_LIMIT,
  LOCATION_HISTORY_MAX_LIMIT,
} from '../locations.constants';

const finiteNumber = z.number().finite();

export const locationDeviceParamSchema = z
  .object({ deviceId: z.string().uuid() })
  .strict();

export const familyLocationParamSchema = z
  .object({ familyId: z.string().uuid() })
  .strict();

export const familyMemberLocationParamSchema = z
  .object({ familyId: z.string().uuid(), memberId: z.string().uuid() })
  .strict();

export const ingestLocationSchema = z
  .object({
    latitude: finiteNumber.min(-90).max(90),
    longitude: finiteNumber.min(-180).max(180),
    accuracy: finiteNumber.min(0).nullable().optional(),
    speed: finiteNumber.min(0).nullable().optional(),
    heading: finiteNumber.min(0).max(360).nullable().optional(),
    batteryLevel: finiteNumber.int().min(0).max(100).nullable().optional(),
    recordedAt: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.heading === 360) {
      context.addIssue({
        code: 'custom',
        path: ['heading'],
        message: 'heading phải nhỏ hơn 360',
      });
    }
    if (
      value.recordedAt.getTime() >
      Date.now() + LOCATION_FUTURE_TOLERANCE_MS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recordedAt'],
        message: 'recordedAt vượt quá thời gian tương lai cho phép',
      });
    }
  });

export const locationHistoryQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(LOCATION_HISTORY_MAX_LIMIT)
      .default(LOCATION_HISTORY_DEFAULT_LIMIT),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(256)
      .optional(),
  })
  .strict();

export type LocationDeviceParam = z.infer<typeof locationDeviceParamSchema>;
export type FamilyLocationParam = z.infer<typeof familyLocationParamSchema>;
export type FamilyMemberLocationParam = z.infer<
  typeof familyMemberLocationParamSchema
>;
export type IngestLocationDto = z.infer<typeof ingestLocationSchema>;
export type LocationHistoryQueryDto = z.infer<
  typeof locationHistoryQuerySchema
>;

export interface LocationHistoryCursor {
  recordedAt: Date;
  id: string;
}
