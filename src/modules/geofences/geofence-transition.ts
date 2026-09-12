export interface GeofenceEvaluationState {
  isInside: boolean;
  lastLocationId: string;
  lastRecordedAt: Date;
}

export type GeofenceEvaluationDecision =
  'initialize' | 'stale' | 'inside' | 'outside' | 'enter' | 'exit';

export function decideGeofenceTransition(
  previous: GeofenceEvaluationState | null,
  nextIsInside: boolean,
  locationId: string,
  recordedAt: Date,
): GeofenceEvaluationDecision {
  if (!previous) return 'initialize';
  if (
    previous.lastRecordedAt > recordedAt ||
    (previous.lastRecordedAt.getTime() === recordedAt.getTime() &&
      previous.lastLocationId >= locationId)
  ) {
    return 'stale';
  }
  if (previous.isInside === nextIsInside) {
    return nextIsInside ? 'inside' : 'outside';
  }
  return nextIsInside ? 'enter' : 'exit';
}
