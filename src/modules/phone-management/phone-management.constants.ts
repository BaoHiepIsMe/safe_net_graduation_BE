export const PHONE_DEFAULT_LIMIT = 20;
export const PHONE_MAX_LIMIT = 100;
export const PHONE_MAX_HISTORY_DAYS = 31;
export const PHONE_COMMAND_TYPES = ['lock', 'ring', 'warning'] as const;
export const PHONE_COMMAND_STATUSES = [
  'pending',
  'sent',
  'completed',
  'failed',
] as const;
export const PHONE_ACK_STATUSES = ['completed', 'failed'] as const;
export const PHONE_TRANSACTION_RETRY_LIMIT = 3;
