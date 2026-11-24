export const REMINDER_DEFAULT_LIMIT = 20;
export const REMINDER_MAX_LIMIT = 100;
export const REMINDER_UPCOMING_MAX_DAYS = 31;
export const REMINDER_DUE_BATCH_SIZE = 50;
export const REMINDER_SCHEDULER_INTERVAL_MS = 60_000;
export const REMINDER_CATCH_UP_WINDOW_MS = 15 * 60_000;
export const REMINDER_TRANSACTION_RETRIES = 3;

export const REMINDER_SCHEDULE_TYPES = ['once', 'daily', 'weekly'] as const;
export type ReminderScheduleType = (typeof REMINDER_SCHEDULE_TYPES)[number];

export const REMINDER_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type ReminderPriority = (typeof REMINDER_PRIORITIES)[number];

export const REMINDER_LOG_DUE = 'due';
export const REMINDER_LOG_COMPLETED = 'completed';
export const REMINDER_LOG_MISSED = 'missed';

/** How long a recipient has to confirm a due occurrence before it is missed. */
export const REMINDER_CONFIRM_WINDOW_MS = 60 * 60_000;

/** Upper bound of reminders and occurrences one agenda day may expand. */
export const REMINDER_AGENDA_MAX_REMINDERS = 200;
export const REMINDER_AGENDA_MAX_OCCURRENCES_PER_REMINDER = 48;

/** Pushed to every viewer when an occurrence changes state. */
export const REMINDER_LOG_UPDATED_EVENT = 'reminder.log.updated';
