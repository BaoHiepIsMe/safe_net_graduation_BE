import { z } from 'zod';
import { CAMERA_DEFAULT_LIMIT, CAMERA_MAX_LIMIT } from '../cameras.constants';

const uuid = z.string().uuid();
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const connectionUrlSchema = z
  .url()
  .max(2048)
  .refine(
    (value) => {
      try {
        return ['rtsp:', 'rtsps:', 'https:'].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    {
      message: 'Connection URL protocol must be rtsp, rtsps, or https',
    },
  );

export const familyCameraParamSchema = z.object({ familyId: uuid }).strict();
export const cameraParamSchema = z
  .object({ familyId: uuid, cameraId: uuid })
  .strict();

export const createCameraSchema = z
  .object({
    name: trimmed(100),
    locationLabel: trimmed(100).nullable().optional(),
    connectionUrl: connectionUrlSchema.optional(),
  })
  .strict();

export const updateCameraSchema = z
  .object({
    name: trimmed(100).optional(),
    locationLabel: trimmed(100).nullable().optional(),
    connectionUrl: connectionUrlSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export const cameraListQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CAMERA_MAX_LIMIT)
      .default(CAMERA_DEFAULT_LIMIT),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(256)
      .optional(),
    active: z.enum(['true', 'false', 'all']).default('true'),
  })
  .strict();

export type FamilyCameraParam = z.infer<typeof familyCameraParamSchema>;
export type CameraParam = z.infer<typeof cameraParamSchema>;
export type CreateCameraDto = z.infer<typeof createCameraSchema>;
export type UpdateCameraDto = z.infer<typeof updateCameraSchema>;
export type CameraListQueryDto = z.infer<typeof cameraListQuerySchema>;

export interface CameraCursor {
  createdAt: Date;
  id: string;
}
