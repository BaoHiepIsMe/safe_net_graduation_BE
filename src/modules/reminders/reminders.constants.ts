export const REMINDER_DEFAULT_LIMIT = 20;
export const REMINDER_MAX_LIMIT = 100;
export const REMINDER_UPCOMING_MAX_DAYS = 31;
export const REMINDER_DUE_BATCH_SIZE = 50;
export const REMINDER_SCHEDULER_INTERVAL_MS = 60_000;
export const REMINDER_CATCH_UP_WINDOW_MS = 15 * 60_000;
export const REMINDER_TRANSACTION_RETRIES = 3;

export const REMINDER_SCHEDULE_TYPES = ['once', 'daily', 'weekly'] as const;
export type ReminderScheduleType = (typeof REMINDER_SCHEDULE_TYPES)[number];

export const REMINDER_LOG_DUE = 'due';
export const REMINDER_LOG_MISSED = 'missed';
