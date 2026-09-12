import { decideGeofenceTransition } from './geofence-transition';

const firstAt = new Date('2026-08-24T00:00:00.000Z');
const nextAt = new Date('2026-08-24T00:00:01.000Z');
const previous = (isInside: boolean) => ({
  isInside,
  lastLocationId: '11111111-1111-4111-8111-111111111111',
  lastRecordedAt: firstAt,
});

describe('geofence transition state machine', () => {
  it('establishes initial state without fabricating a transition', () => {
    expect(
      decideGeofenceTransition(
        null,
        true,
        '22222222-2222-4222-8222-222222222222',
        firstAt,
      ),
    ).toBe('initialize');
  });

  it('maps outside to inside to enter', () => {
    expect(
      decideGeofenceTransition(
        previous(false),
        true,
        '22222222-2222-4222-8222-222222222222',
        nextAt,
      ),
    ).toBe('enter');
  });

  it('maps inside to outside to exit', () => {
    expect(
      decideGeofenceTransition(
        previous(true),
        false,
        '22222222-2222-4222-8222-222222222222',
        nextAt,
      ),
    ).toBe('exit');
  });

  it('does not emit repeated inside or outside events', () => {
    expect(
      decideGeofenceTransition(
        previous(true),
        true,
        '22222222-2222-4222-8222-222222222222',
        nextAt,
      ),
    ).toBe('inside');
    expect(
      decideGeofenceTransition(
        previous(false),
        false,
        '22222222-2222-4222-8222-222222222222',
        nextAt,
      ),
    ).toBe('outside');
  });

  it('rejects older and duplicate location evaluations', () => {
    expect(
      decideGeofenceTransition(
        previous(false),
        true,
        '33333333-3333-4333-8333-333333333333',
        new Date(0),
      ),
    ).toBe('stale');
    expect(
      decideGeofenceTransition(
        previous(false),
        true,
        previous(false).lastLocationId,
        firstAt,
      ),
    ).toBe('stale');
  });

  it('uses the location UUID as a deterministic equal-time tie-break', () => {
    expect(
      decideGeofenceTransition(
        previous(false),
        true,
        '00000000-0000-4000-8000-000000000000',
        firstAt,
      ),
    ).toBe('stale');
    expect(
      decideGeofenceTransition(
        previous(false),
        true,
        '22222222-2222-4222-8222-222222222222',
        firstAt,
      ),
    ).toBe('enter');
  });
});
