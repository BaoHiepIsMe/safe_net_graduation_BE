import { z } from 'zod';
import { pagePaginationSchema } from '../../../common/dto/pagination.dto';
import { DEVICE_PLATFORMS } from '../devices.constants';

const deviceNameSchema = z.string().trim().min(1).max(100);
const operatingSystemSchema = z.string().trim().min(1).max(30);
const batteryLevelSchema = z.number().int().min(0).max(100);
const fcmTokenSchema = z
  .string()
  .trim()
  .min(16)
  .max(1024)
  .regex(
    /^[\x21-\x7E]+$/,
    'FCM token phải là chuỗi ASCII không có khoảng trắng',
  );

export const deviceIdParamSchema = z
  .object({ deviceId: z.string().uuid() })
  .strict();

export const devicePaginationSchema = pagePaginationSchema.strict();

export const registerDeviceSchema = z
  .object({
    installationId: z.string().uuid(),
    deviceName: deviceNameSchema.nullable().optional(),
    platform: z.enum(DEVICE_PLATFORMS),
    operatingSystem: operatingSystemSchema.nullable().optional(),
    fcmToken: fcmTokenSchema.nullable().optional(),
    batteryLevel: batteryLevelSchema.nullable().optional(),
  })
  .strict();

export const updateDeviceSchema = z
  .object({
    deviceName: deviceNameSchema.nullable().optional(),
    platform: z.enum(DEVICE_PLATFORMS).optional(),
    operatingSystem: operatingSystemSchema.nullable().optional(),
    fcmToken: fcmTokenSchema.nullable().optional(),
    batteryLevel: batteryLevelSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Cần cung cấp ít nhất một trường để cập nhật',
  });

export const deviceHeartbeatSchema = z
  .object({
    batteryLevel: batteryLevelSchema.nullable().optional(),
  })
  .strict();

export type DeviceIdParam = z.infer<typeof deviceIdParamSchema>;
export type DevicePaginationDto = z.infer<typeof devicePaginationSchema>;
export type RegisterDeviceDto = z.infer<typeof registerDeviceSchema>;
export type UpdateDeviceDto = z.infer<typeof updateDeviceSchema>;
export type DeviceHeartbeatDto = z.infer<typeof deviceHeartbeatSchema>;
