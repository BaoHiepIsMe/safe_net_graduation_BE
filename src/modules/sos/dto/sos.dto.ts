import { z } from 'zod';
import { LOCATION_FUTURE_TOLERANCE_MS } from '../../locations/locations.constants';
import { SOS_DEFAULT_LIMIT, SOS_MAX_LIMIT } from '../sos.constants';

const uuid = z.string().uuid();
const finiteNumber = z.number().finite();

/**
 * One-shot GPS fix taken by the phone at trigger time. It is independent of
 * location sharing and is stored only on the SOS event (never in history).
 */
export const emergencyLocationSchema = z
  .object({
    latitude: finiteNumber.min(-90).max(90),
    longitude: finiteNumber.min(-180).max(180),
    accuracy: finiteNumber.min(0).nullable().optional(),
    recordedAt: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
  })
  .strict()
  .refine(
    (value) =>
      value.recordedAt.getTime() <= Date.now() + LOCATION_FUTURE_TOLERANCE_MS,
    {
      path: ['recordedAt'],
      message: 'recordedAt vượt quá thời gian tương lai cho phép',
    },
  );
const normalizedPhone = z
  .string()
  .trim()
  .min(8)
  .max(30)
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .pipe(z.string().regex(/^\+?[1-9]\d{7,14}$/));

export const createSosContactSchema = z
  .object({
    contactName: z.string().trim().min(1).max(100),
    phone: normalizedPhone,
    contactUserId: uuid.nullable().optional(),
    priority: z.number().int().min(1).max(100).default(1),
  })
  .strict();

export const updateSosContactSchema = z
  .object({
    contactName: z.string().trim().min(1).max(100).optional(),
    phone: normalizedPhone.optional(),
    contactUserId: uuid.nullable().optional(),
    priority: z.number().int().min(1).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export const sosContactParamSchema = z.object({ contactId: uuid }).strict();
export const sosEventParamSchema = z.object({ sosEventId: uuid }).strict();

export const sosContactListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(SOS_MAX_LIMIT)
      .default(SOS_DEFAULT_LIMIT),
    active: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();

export const triggerSosSchema = z
  .object({
    clientRequestId: uuid,
    deviceId: uuid.optional(),
    message: z.string().trim().min(1).max(500).optional(),
    location: emergencyLocationSchema.optional(),
  })
  .strict();

export const sosHistoryQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(SOS_MAX_LIMIT)
      .default(SOS_DEFAULT_LIMIT),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(256)
      .optional(),
    status: z.enum(['active', 'resolved', 'cancelled']).optional(),
  })
  .strict();

export const emptySosTransitionSchema = z.object({}).strict();

export type CreateSosContactDto = z.infer<typeof createSosContactSchema>;
export type UpdateSosContactDto = z.infer<typeof updateSosContactSchema>;
export type SosContactParam = z.infer<typeof sosContactParamSchema>;
export type SosEventParam = z.infer<typeof sosEventParamSchema>;
export type SosContactListQueryDto = z.infer<typeof sosContactListQuerySchema>;
export type TriggerSosDto = z.infer<typeof triggerSosSchema>;
export type SosHistoryQueryDto = z.infer<typeof sosHistoryQuerySchema>;

export interface SosHistoryCursor {
  triggeredAt: Date;
  id: string;
}
