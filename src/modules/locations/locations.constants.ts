export const LOCATION_EVENT_NAME = 'location.updated';
export const LOCATION_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
export const LOCATION_TRANSACTION_RETRY_LIMIT = 3;
export const LOCATION_HISTORY_DEFAULT_LIMIT = 50;
export const LOCATION_HISTORY_MAX_LIMIT = 100;
export const LOCATION_FAMILY_HISTORY_MAX_DAYS = 7;

// Signal-loss alerts. The phone reports every 2 minutes in continuous mode and
// every 10 in battery saver (4 missed reports before an alert).
export const SIGNAL_LOSS_SCAN_INTERVAL_MS = 60_000;
export const SIGNAL_LOSS_BATCH_SIZE = 50;
export const SIGNAL_LOSS_THRESHOLD_MS = {
  continuous: 8 * 60 * 1000,
  battery_saver: 25 * 60 * 1000,
} as const;
// Older silences were either alerted already or belong to a dormant phone.
export const SIGNAL_LOSS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export type SignalLossReason = 'no_connection' | 'no_location';
