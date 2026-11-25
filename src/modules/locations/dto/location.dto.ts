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

export const setLocationViewersSchema = z
  .object({ viewerUserIds: z.array(z.string().uuid()).max(100) })
  .strict()
  .refine((v) => new Set(v.viewerUserIds).size === v.viewerUserIds.length, {
    message: 'viewerUserIds must be unique',
    path: ['viewerUserIds'],
  });

export type SetLocationViewersDto = z.infer<typeof setLocationViewersSchema>;

// Plugin chạy ngầm dùng giá trị âm (-1) cho tốc độ/hướng/pin không biết: coi như null
const unknownToNull = (value: unknown) =>
  typeof value === 'number' && value < 0 ? null : value;

export const ingestLocationSchema = z.preprocess(
  (input) => {
    if (typeof input !== 'object' || input === null) return input;
    const body = input as Record<string, unknown>;
    return {
      ...body,
      speed: unknownToNull(body.speed),
      heading: unknownToNull(body.heading),
      batteryRatio: unknownToNull(body.batteryRatio),
    };
  },
  z
    .object({
      latitude: finiteNumber.min(-90).max(90),
      longitude: finiteNumber.min(-180).max(180),
      accuracy: finiteNumber.min(0).nullable().optional(),
      speed: finiteNumber.min(0).nullable().optional(),
      heading: finiteNumber.min(0).max(360).nullable().optional(),
      batteryLevel: finiteNumber.int().min(0).max(100).nullable().optional(),
      batteryRatio: finiteNumber.min(0).max(1).nullable().optional(),
      recordedAt: z.iso
        .datetime({ offset: true })
        .transform((value) => new Date(value)),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.batteryRatio != null && value.batteryLevel != null) {
        context.addIssue({
          code: 'custom',
          path: ['batteryRatio'],
          message: 'không gửi đồng thời batteryLevel và batteryRatio',
        });
      }
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
    })
    // batteryRatio (0–1) đổi thành batteryLevel phần trăm nguyên sau khi validate
    // Chỉ ghi đè khi có batteryRatio để batteryLevel vẫn là key optional
    .transform(({ batteryRatio, ...value }) =>
      batteryRatio == null
        ? value
        : { ...value, batteryLevel: Math.round(batteryRatio * 100) },
    ),
);

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
    from: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .optional(),
    to: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && value.from >= value.to) {
      context.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'from phải trước to',
      });
    }
  });

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

export interface LocationHistoryRange {
  from?: Date;
  to?: Date;
}
