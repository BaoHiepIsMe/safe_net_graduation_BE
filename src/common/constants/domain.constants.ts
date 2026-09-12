export enum FamilyRole {
  MANAGER = 'manager',
  ADULT = 'adult',
  CHILD = 'child',
  ELDER = 'elder',
}

export enum MembershipStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  REMOVED = 'removed',
}

export enum FamilyLabel {
  FATHER = 'father',
  MOTHER = 'mother',
  SON = 'son',
  DAUGHTER = 'daughter',
  GRANDFATHER = 'grandfather',
  GRANDMOTHER = 'grandmother',
  CAREGIVER = 'caregiver',
  OTHER = 'other',
}

export enum FamilyStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

export enum DeviceType {
  ANDROID = 'android',
  IOS = 'ios',
  WEB = 'web',
  OTHER = 'other',
}

export enum MotionState {
  STILL = 'still',
  WALKING = 'walking',
  RUNNING = 'running',
  IN_VEHICLE = 'in_vehicle',
  ON_BICYCLE = 'on_bicycle',
  UNKNOWN = 'unknown',
}

export enum GeofenceEventType {
  ENTER = 'enter',
  EXIT = 'exit',
}

export enum CameraStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  ERROR = 'error',
  DISABLED = 'disabled',
}

export enum FallSourceType {
  PHONE = 'phone',
  CAMERA = 'camera',
  MANUAL = 'manual',
}

export enum FallEventStatus {
  DETECTED = 'detected',
  CONFIRMED = 'confirmed',
  FALSE_ALARM = 'false_alarm',
  RESOLVED = 'resolved',
}

export enum ReminderType {
  MEDICATION = 'medication',
  APPOINTMENT = 'appointment',
  WATER = 'water',
  EXERCISE = 'exercise',
  CUSTOM = 'custom',
}

export enum ReminderLogStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  MISSED = 'missed',
  SKIPPED = 'skipped',
}

export enum NotificationType {
  FALL_DETECTED = 'fall_detected',
  GEOFENCE_ENTER = 'geofence_enter',
  GEOFENCE_EXIT = 'geofence_exit',
  REMINDER = 'reminder',
  SOS = 'sos',
  PHONE_COMMAND = 'phone_command',
  SYSTEM = 'system',
  INVITATION = 'invitation',
  MESSAGE = 'message',
}

export enum SosEventStatus {
  TRIGGERED = 'triggered',
  CALLING = 'calling',
  HANDLED = 'handled',
  CANCELLED = 'cancelled',
}

export enum PhoneCommandType {
  LOCK = 'lock',
  UNLOCK = 'unlock',
  RING = 'ring',
  WARNING = 'warning',
  WIPE = 'wipe',
  LOCATE = 'locate',
}

export enum PhoneCommandStatus {
  PENDING = 'pending',
  SENT = 'sent',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum ConversationType {
  DIRECT = 'direct',
  GROUP = 'group',
}

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  LOCATION = 'location',
  SYSTEM = 'system',
}

export enum MessageDeliveryStatus {
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
}

export enum CallType {
  AUDIO = 'audio',
  VIDEO = 'video',
}

export enum CallStatus {
  MISSED = 'missed',
  COMPLETED = 'completed',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}
