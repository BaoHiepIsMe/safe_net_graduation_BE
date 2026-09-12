export const CALL_DEFAULT_LIMIT = 30;
export const CALL_MAX_LIMIT = 100;
export const CALL_DUE_BATCH_SIZE = 50;
export const CALL_SWEEP_INTERVAL_MS = 15_000;
export const CALL_TRANSACTION_RETRY_LIMIT = 3;
export const CALL_SIGNAL_WINDOW_MS = 60_000;
export const CALL_SIGNAL_MAX_PER_WINDOW = 120;
export const CALL_MAX_SDP_LENGTH = 16_384;
export const CALL_MAX_ICE_CANDIDATE_LENGTH = 2_048;

export const CALL_CREATED_EVENT = 'call.created';
export const CALL_ACCEPTED_EVENT = 'call.accepted';
export const CALL_REJECTED_EVENT = 'call.rejected';
export const CALL_CANCELLED_EVENT = 'call.cancelled';
export const CALL_MISSED_EVENT = 'call.missed';
export const CALL_ENDED_EVENT = 'call.ended';
export const CALL_SIGNAL_EVENT = 'call.signal';

export const CALL_NOTIFICATION_TYPE = 'call_incoming';
export const CALL_NOTIFICATION_SOURCE = 'call_log';

export type CallType = 'voice' | 'video';
export type CallStatus =
  'ringing' | 'accepted' | 'rejected' | 'cancelled' | 'missed' | 'ended';
export type CallAction = 'accept' | 'reject' | 'cancel' | 'end';
