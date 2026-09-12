export const NOTIFICATION_CREATED_EVENT = 'notification.created';
export const NOTIFICATION_DEFAULT_LIMIT = 20;
export const NOTIFICATION_MAX_LIMIT = 100;
export const NOTIFICATION_SOURCE_GEOFENCE_EVENT = 'geofence_event';
export const NOTIFICATION_SOURCE_SOS_EVENT = 'sos_event';
export const NOTIFICATION_SOURCE_REMINDER_LOG = 'reminder_log';
export const NOTIFICATION_SOURCE_MESSAGE = 'message';
export const NOTIFICATION_SOURCE_CALL = 'call_log';
export const NOTIFICATION_DELIVERY_MAX_ATTEMPTS = 2;

export type NotificationType =
  | 'geofence_enter'
  | 'geofence_exit'
  | 'sos_alert'
  | 'reminder'
  | 'message'
  | 'call_incoming';
