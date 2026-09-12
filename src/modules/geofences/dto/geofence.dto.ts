import { z } from 'zod';
import {
  GEOFENCE_DEFAULT_LIMIT,
  GEOFENCE_MAX_LIMIT,
  GEOFENCE_MAX_RADIUS_METERS,
} from '../geofences.constants';

const uuid = z.string().uuid();
const finite = z.number().finite();
const assignmentSchema = z
  .object({
    memberId: uuid,
    notifyOnEnter: z.boolean().default(true),
    notifyOnExit: z.boolean().default(true),
  })
  .strict();

const uniqueAssignments = (
  value: { memberId: string }[],
  context: z.RefinementCtx,
) => {
  if (new Set(value.map((item) => item.memberId)).size !== value.length) {
    context.addIssue({
      code: 'custom',
      message: 'memberId must be unique',
      path: ['members'],
    });
  }
};

export const geofenceFamilyParamSchema = z.object({ familyId: uuid }).strict();
export const geofenceParamSchema = z
  .object({ familyId: uuid, geofenceId: uuid })
  .strict();

export const createGeofenceSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    address: z.string().trim().max(500).nullable().optional(),
    centerLatitude: finite.min(-90).max(90),
    centerLongitude: finite.min(-180).max(180),
    radiusMeters: finite.int().min(1).max(GEOFENCE_MAX_RADIUS_METERS),
    members: z.array(assignmentSchema).max(100).default([]),
  })
  .strict()
  .superRefine((value, context) => uniqueAssignments(value.members, context));

export const updateGeofenceSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    address: z.string().trim().max(500).nullable().optional(),
    centerLatitude: finite.min(-90).max(90).optional(),
    centerLongitude: finite.min(-180).max(180).optional(),
    radiusMeters: finite
      .int()
      .min(1)
      .max(GEOFENCE_MAX_RADIUS_METERS)
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export const replaceGeofenceMembersSchema = z
  .object({ members: z.array(assignmentSchema).max(100) })
  .strict()
  .superRefine((value, context) => uniqueAssignments(value.members, context));

export const geofenceListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(GEOFENCE_MAX_LIMIT)
      .default(GEOFENCE_DEFAULT_LIMIT),
    active: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();

export const geofenceEventQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(GEOFENCE_MAX_LIMIT)
      .default(GEOFENCE_DEFAULT_LIMIT),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(256)
      .optional(),
    geofenceId: uuid.optional(),
    memberId: uuid.optional(),
    eventType: z.enum(['enter', 'exit']).optional(),
  })
  .strict();

export type CreateGeofenceDto = z.infer<typeof createGeofenceSchema>;
export type UpdateGeofenceDto = z.infer<typeof updateGeofenceSchema>;
export type ReplaceGeofenceMembersDto = z.infer<
  typeof replaceGeofenceMembersSchema
>;
export type GeofenceListQueryDto = z.infer<typeof geofenceListQuerySchema>;
export type GeofenceEventQueryDto = z.infer<typeof geofenceEventQuerySchema>;
export type GeofenceParam = z.infer<typeof geofenceParamSchema>;
export type GeofenceFamilyParam = z.infer<typeof geofenceFamilyParamSchema>;
export interface GeofenceEventCursor {
  detectedAt: Date;
  id: string;
}
