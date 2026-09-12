import { z } from 'zod';
import {
  NOTIFICATION_DEFAULT_LIMIT,
  NOTIFICATION_MAX_LIMIT,
} from '../notifications.constants';

export const notificationParamSchema = z
  .object({ notificationId: z.string().uuid() })
  .strict();

export const notificationListQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(NOTIFICATION_MAX_LIMIT)
      .default(NOTIFICATION_DEFAULT_LIMIT),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(256)
      .optional(),
    read: z.enum(['all', 'read', 'unread']).default('all'),
    type: z
      .enum([
        'geofence_enter',
        'geofence_exit',
        'sos_alert',
        'reminder',
        'message',
        'call_incoming',
      ])
      .optional(),
  })
  .strict();

export const emptyNotificationMutationSchema = z.object({}).strict();

export type NotificationParam = z.infer<typeof notificationParamSchema>;
export type NotificationListQueryDto = z.infer<
  typeof notificationListQuerySchema
>;
export interface NotificationCursor {
  createdAt: Date;
  id: string;
}
