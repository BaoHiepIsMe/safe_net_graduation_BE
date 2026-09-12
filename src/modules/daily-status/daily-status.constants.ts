export const DAILY_STATUS_DEFAULT_LIMIT = 30;
export const DAILY_STATUS_MAX_LIMIT = 100;
export const DAILY_STATUS_SCHEDULER_INTERVAL_MS = 15 * 60 * 1000;
export const DAILY_STATUS_DUE_BATCH_SIZE = 50;
export const DAILY_STATUS_SCHEMA_VERSION = 1;
export const DAILY_STATUS_TOP_APPS_LIMIT = 5;
export const DAILY_STATUS_TRANSACTION_RETRY_LIMIT = 3;

export const DAILY_STATUS_ELIGIBLE_ROLES = ['child', 'elder'] as const;

export type DailyStatusAvailability = 'available' | 'no_data';
