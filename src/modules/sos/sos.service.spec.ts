import { ErrorCode } from '../../common/constants/error-codes';
import {
  AppError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app.error';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { SosRepository } from './sos.repository';
import { SosService } from './sos.service';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const RECIPIENT = '22222222-2222-4222-8222-222222222222';
const EVENT = '33333333-3333-4333-8333-333333333333';
const REQUEST = '44444444-4444-4444-8444-444444444444';
const CONTACT = '55555555-5555-4555-8555-555555555555';
const at = new Date('2026-08-31T00:00:00.000Z');

const event = (overrides: Record<string, unknown> = {}) => ({
  id: EVENT,
  actorUserId: ACTOR,
  clientRequestId: REQUEST,
  status: 'active',
  latitude: 10.7,
  longitude: 106.6,
  locationAccuracy: 5,
  locationRecordedAt: at,
  note: 'Please help',
  triggeredAt: at,
  resolvedAt: null,
  cancelledAt: null,
  actor: { id: ACTOR, fullName: 'Actor', avatarUrl: null },
  recipients: [{ recipientUserId: ACTOR }, { recipientUserId: RECIPIENT }],
  ...overrides,
});

describe('SosService', () => {
  function setup() {
    const repository = {
      createContact: jest.fn(),
      listContacts: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
      updateContact: jest.fn(),
      deleteContact: jest.fn(),
      trigger: jest
        .fn()
        .mockResolvedValue({ outcome: 'created', event: event() }),
      listHistory: jest.fn().mockResolvedValue([]),
      findAuthorized: jest.fn().mockResolvedValue(event()),
      transition: jest.fn(),
    };
    const notifications = {
      processSosEvent: jest
        .fn()
        .mockImplementation(
          (_eventId: string, afterNotificationCommit?: () => void) => {
            afterNotificationCommit?.();
            return Promise.resolve([]);
          },
        ),
    };
    const realtime = { emitToUser: jest.fn() };
    return {
      repository,
      notifications,
      realtime,
      service: new SosService(
        repository as unknown as SosRepository,
        notifications as unknown as NotificationsService,
        realtime as unknown as RealtimeGateway,
      ),
    };
  }

  it('derives the actor from authentication, persists first, then notifies private recipients', async () => {
    const { repository, notifications, realtime, service } = setup();
    const result = await service.trigger(ACTOR, {
      clientRequestId: REQUEST,
      message: 'Please help',
    });
    expect(repository.trigger).toHaveBeenCalledWith(
      ACTOR,
      { clientRequestId: REQUEST, message: 'Please help' },
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
    expect(notifications.processSosEvent).toHaveBeenCalledWith(
      EVENT,
      expect.any(Function),
    );
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      RECIPIENT,
      'sos.created',
      expect.objectContaining({ id: EVENT, locationAvailable: true }),
    );
    expect(realtime.emitToUser.mock.calls[0][2]).not.toHaveProperty('location');
    expect(result.location).toMatchObject({ available: true, latitude: 10.7 });
  });

  it('keeps the idempotency fingerprint independent of the GPS fix', async () => {
    const { repository, service } = setup();
    const at = new Date('2026-11-16T08:00:00Z');
    await service.trigger(ACTOR, {
      clientRequestId: REQUEST,
      location: { latitude: 21.03, longitude: 105.85, recordedAt: at },
    });
    await service.trigger(ACTOR, {
      clientRequestId: REQUEST,
      location: { latitude: 21.0301, longitude: 105.8502, recordedAt: at },
    });
    await service.trigger(ACTOR, { clientRequestId: REQUEST });
    const fingerprints = repository.trigger.mock.calls.map(
      (call: unknown[]) => call[2],
    );
    expect(new Set(fingerprints).size).toBe(1);
  });

  it('reuses the same logical SOS without another sos.created emission', async () => {
    const { repository, notifications, realtime, service } = setup();
    repository.trigger.mockResolvedValue({ outcome: 'reused', event: event() });
    const result = await service.trigger(ACTOR, { clientRequestId: REQUEST });
    expect(result.id).toBe(EVENT);
    expect(notifications.processSosEvent).toHaveBeenCalledWith(
      EVENT,
      expect.any(Function),
    );
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  it.each([
    ['idempotency_conflict', ErrorCode.SOS_IDEMPOTENCY_CONFLICT],
    ['already_active', ErrorCode.SOS_ALREADY_ACTIVE],
  ])('returns a stable conflict for %s', async (outcome, code) => {
    const { repository, service } = setup();
    repository.trigger.mockResolvedValue({ outcome, eventId: EVENT });
    await expect(
      service.trigger(ACTOR, { clientRequestId: REQUEST }),
    ).rejects.toMatchObject({ code });
  });

  it('hides a foreign/inactive device as not found', async () => {
    const { repository, service } = setup();
    repository.trigger.mockResolvedValue({ outcome: 'invalid_device' });
    await expect(
      service.trigger(ACTOR, {
        clientRequestId: REQUEST,
        deviceId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: ErrorCode.DEVICE_NOT_FOUND });
  });

  it('keeps the SOS without claiming realtime delivery when notification persistence fails', async () => {
    const { notifications, realtime, service } = setup();
    notifications.processSosEvent.mockRejectedValue(new Error('rollback'));
    await expect(
      service.trigger(ACTOR, { clientRequestId: REQUEST }),
    ).resolves.toMatchObject({ id: EVENT, status: 'active' });
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  it('allows a no-location SOS and reports location unavailable', async () => {
    const { repository, service } = setup();
    repository.trigger.mockResolvedValue({
      outcome: 'created',
      event: event({
        latitude: null,
        longitude: null,
        locationAccuracy: null,
        locationRecordedAt: null,
      }),
    });
    await expect(
      service.trigger(ACTOR, { clientRequestId: REQUEST }),
    ).resolves.toMatchObject({
      location: {
        available: false,
        latitude: null,
        longitude: null,
        recordedAt: null,
      },
    });
  });

  it('supports idempotent resolve/cancel and rejects cross-terminal transitions', async () => {
    const { repository, realtime, service } = setup();
    repository.transition.mockResolvedValue({
      outcome: 'updated',
      event: event({ status: 'resolved', resolvedAt: at }),
    });
    await service.resolve(ACTOR, EVENT);
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      RECIPIENT,
      'sos.resolved',
      expect.objectContaining({ status: 'resolved' }),
    );
    repository.transition.mockResolvedValue({
      outcome: 'unchanged',
      event: event({ status: 'resolved', resolvedAt: at }),
    });
    await expect(service.resolve(ACTOR, EVENT)).resolves.toMatchObject({
      status: 'resolved',
    });
    repository.transition.mockResolvedValue({
      outcome: 'invalid_state',
      currentStatus: 'resolved',
    });
    await expect(service.cancel(ACTOR, EVENT)).rejects.toMatchObject({
      code: ErrorCode.SOS_INVALID_STATE,
    });
  });

  it('hides foreign SOS detail and transition existence', async () => {
    const { repository, service } = setup();
    repository.findAuthorized.mockResolvedValue(null);
    await expect(service.detail(RECIPIENT, EVENT)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    repository.transition.mockResolvedValue({ outcome: 'not_found' });
    await expect(service.resolve(RECIPIENT, EVENT)).rejects.toMatchObject({
      code: ErrorCode.SOS_EVENT_NOT_FOUND,
    });
  });

  it('uses bounded owner history with opaque cursor validation', async () => {
    const { repository, service } = setup();
    repository.listHistory.mockResolvedValue([event()]);
    const result = await service.history(ACTOR, { limit: 20 });
    expect(repository.listHistory).toHaveBeenCalledWith(
      ACTOR,
      { limit: 20 },
      undefined,
    );
    expect(result.data).toHaveLength(1);
    await expect(
      service.history(ACTOR, { limit: 20, cursor: 'bad' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('keeps emergency contact operations owner-scoped with stable errors', async () => {
    const { repository, service } = setup();
    const contact = { id: CONTACT, contactName: 'Parent' };
    repository.createContact.mockResolvedValue({ outcome: 'created', contact });
    await service.createContact(ACTOR, {
      contactName: 'Parent',
      phone: '+84912345678',
      priority: 1,
    });
    expect(repository.createContact).toHaveBeenCalledWith(
      ACTOR,
      expect.any(Object),
    );
    repository.updateContact.mockResolvedValue({ outcome: 'not_found' });
    await expect(
      service.updateContact(RECIPIENT, CONTACT, { contactName: 'Stolen' }),
    ).rejects.toMatchObject({ code: ErrorCode.EMERGENCY_CONTACT_NOT_FOUND });
    repository.deleteContact.mockResolvedValue({ count: 0 });
    await expect(
      service.deleteContact(RECIPIENT, CONTACT),
    ).rejects.toBeInstanceOf(AppError);
  });
});
