import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway';
import { GeofenceEvaluationService } from './geofence-evaluation.service';
import {
  GEOFENCE_ENTERED_EVENT,
  GEOFENCE_EXITED_EVENT,
} from './geofences.constants';
import { GeofencesRepository } from './geofences.repository';
import { NotificationsService } from '../notifications/notifications.service';

const USER = '11111111-1111-4111-8111-111111111111';
const event = (eventType: 'enter' | 'exit') => ({
  id: '22222222-2222-4222-8222-222222222222',
  familyId: '33333333-3333-4333-8333-333333333333',
  geofenceId: '44444444-4444-4444-8444-444444444444',
  geofenceName: 'Home',
  memberId: '55555555-5555-4555-8555-555555555555',
  eventType,
  latitude: 10.7,
  longitude: 106.6,
  occurredAt: new Date('2026-08-24T00:00:00.000Z'),
  recipientUserIds: [USER],
});

describe('GeofenceEvaluationService', () => {
  const location = {
    id: '66666666-6666-4666-8666-666666666666',
    userId: USER,
    latitude: 10.7,
    longitude: 106.6,
    recordedAt: new Date(),
  };

  function setup() {
    const repository = { evaluateCommittedLocation: jest.fn() };
    const realtime = { emitToUser: jest.fn() };
    const notifications = {
      processGeofenceEvent: jest.fn().mockResolvedValue([]),
    };
    return {
      repository,
      realtime,
      notifications,
      service: new GeofenceEvaluationService(
        repository as unknown as GeofencesRepository,
        realtime as unknown as RealtimeGateway,
        notifications as unknown as NotificationsService,
      ),
    };
  }

  it.each([
    ['enter' as const, GEOFENCE_ENTERED_EVENT],
    ['exit' as const, GEOFENCE_EXITED_EVENT],
  ])('emits persisted %s after repository commit', async (transition, name) => {
    const { repository, realtime, service } = setup();
    let commit: ((value: unknown) => void) | undefined;
    repository.evaluateCommittedLocation.mockReturnValue(
      new Promise((resolve) => {
        commit = resolve;
      }),
    );
    const pending = service.evaluateCommittedLocation(location);
    expect(realtime.emitToUser).not.toHaveBeenCalled();
    commit?.([event(transition)]);
    await pending;
    expect(realtime.emitToUser).toHaveBeenCalledWith(USER, name, {
      id: expect.any(String),
      familyId: expect.any(String),
      geofence: { id: expect.any(String), name: 'Home' },
      memberId: expect.any(String),
      transition,
      location: { latitude: 10.7, longitude: 106.6 },
      occurredAt: expect.any(Date),
    });
  });

  it('emits nothing for initialization, same-state, stale, or duplicate evaluations', async () => {
    const { repository, realtime, service } = setup();
    repository.evaluateCommittedLocation.mockResolvedValue([]);
    await service.evaluateCommittedLocation(location);
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  it('emits nothing when persistence fails', async () => {
    const { repository, realtime, service } = setup();
    repository.evaluateCommittedLocation.mockRejectedValue(
      new Error('rollback'),
    );
    await expect(service.evaluateCommittedLocation(location)).rejects.toThrow(
      'rollback',
    );
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  it('does not emit notification realtime when notification persistence fails', async () => {
    const { repository, realtime, notifications, service } = setup();
    repository.evaluateCommittedLocation.mockResolvedValue([event('enter')]);
    notifications.processGeofenceEvent.mockRejectedValue(
      new Error('notification rollback'),
    );
    await expect(
      service.evaluateCommittedLocation(location),
    ).resolves.toHaveLength(1);
    expect(notifications.processGeofenceEvent).toHaveBeenCalledWith(
      event('enter').id,
    );
    expect(realtime.emitToUser).toHaveBeenCalledTimes(1);
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      USER,
      GEOFENCE_ENTERED_EVENT,
      expect.any(Object),
    );
  });

  it('uses only private user-room delivery and a safe payload', async () => {
    const { repository, realtime, service } = setup();
    repository.evaluateCommittedLocation.mockResolvedValue([event('enter')]);
    await service.evaluateCommittedLocation(location);
    const payload = realtime.emitToUser.mock.calls[0][2];
    expect(payload).not.toHaveProperty('fcmToken');
    expect(payload).not.toHaveProperty('installationId');
    expect(payload).not.toHaveProperty('locationId');
  });

  it('keeps a committed transition successful when realtime delivery fails', async () => {
    const { repository, realtime, service } = setup();
    repository.evaluateCommittedLocation.mockResolvedValue([event('enter')]);
    realtime.emitToUser.mockImplementation(() => {
      throw new Error('socket unavailable');
    });

    await expect(
      service.evaluateCommittedLocation(location),
    ).resolves.toHaveLength(1);
    expect(repository.evaluateCommittedLocation).toHaveBeenCalledTimes(1);
  });
});
