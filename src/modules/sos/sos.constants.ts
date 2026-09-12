export const SOS_DEFAULT_LIMIT = 20;
export const SOS_MAX_LIMIT = 100;
export const SOS_TRANSACTION_RETRY_LIMIT = 3;
export const SOS_CREATED_EVENT = 'sos.created';
export const SOS_RESOLVED_EVENT = 'sos.resolved';
export const SOS_CANCELLED_EVENT = 'sos.cancelled';

export type SosStatus = 'active' | 'resolved' | 'cancelled';
