import { NotFoundError, ValidationError } from '../../common/errors/app.error';
import { FirebaseService } from '../../infrastructure/firebase/firebase.service';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const NOTIFICATION_ID = '33333333-3333-4333-8333-333333333333';
const DEVICE_ID = '44444444-4444-4444-8444-444444444444';
const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const now = new Date('2026-08-27T00:00:00.000Z');
const row = {
  id: NOTIFICATION_ID,
  family_id: null,
  notification_type: 'geofence_enter',
  title: 'Safe-zone enter',
  message: 'Member entered Home',
  metadata: { geofenceId: crypto.randomUUID() },
  is_read: false,
  read_at: null,
  created_at: now,
};

describe('NotificationsService', () => {
  function setup() {
    const repository = {
      createFromGeofenceEvent: jest.fn().mockResolvedValue([]),
      createFromSosEvent: jest.fn().mockResolvedValue([]),
      createFromReminderLog: jest.fn().mockResolvedValue([]),
      createFromMessage: jest.fn().mockResolvedValue([]),
      createFromCall: jest.fn().mockResolvedValue([]),
      listPendingDeliveries: jest.fn().mockResolvedValue([]),
      recordDeliveryAttempt: jest.fn().mockResolvedValue({}),
      clearInvalidToken: jest.fn().mockResolvedValue({ count: 1 }),
      listOwned: jest.fn().mockResolvedValue([]),
      findOwned: jest.fn().mockResolvedValue(row),
      unreadCount: jest.fn().mockResolvedValue(2),
      markAllRead: jest.fn().mockResolvedValue({ count: 2 }),
      markRead: jest
        .fn()
        .mockResolvedValue({ ...row, is_read: true, read_at: now }),
    };
    const firebase = { sendPushNotification: jest.fn() };
    const realtime = { emitToUser: jest.fn() };
    return {
      repository,
      firebase,
      realtime,
      service: new NotificationsService(
        repository as unknown as NotificationsRepository,
        firebase as unknown as FirebaseService,
        realtime as unknown as RealtimeGateway,
      ),
    };
  }

  const delivery = () => ({
    id: DELIVERY_ID,
    attemptCount: 0,
    device: { id: DEVICE_ID, fcmToken: 'private-token', isActive: true },
    notification: {
      id: NOTIFICATION_ID,
      title: row.title,
      message: row.message,
      notification_type: row.notification_type,
      profiles_notifications_recipient_user_idToprofiles: {
        UserSetting: { pushNotificationsEnabled: true as boolean },
      },
    },
  });

  it('emits only after durable creation and only to the private recipient room', async () => {
    const { repository, realtime, service } = setup();
    repository.createFromGeofenceEvent.mockResolvedValue([
      { notification: row, recipientUserId: USER_ID },
    ]);
    await service.processGeofenceEvent(crypto.randomUUID());
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      USER_ID,
      'notification.created',
      expect.objectContaining({ id: NOTIFICATION_ID }),
    );
    const payload = realtime.emitToUser.mock.calls[0][2];
    expect(payload).not.toHaveProperty('fcmToken');
    expect(payload).not.toHaveProperty('deliveries');
    expect(payload).not.toHaveProperty('errorCategory');
  });

  it('uses the same persisted notification pipeline for SOS alerts', async () => {
    const { repository, realtime, service } = setup();
    repository.createFromSosEvent.mockResolvedValue([
      {
        notification: {
          ...row,
          notification_type: 'sos_alert',
          metadata: {
            sosEventId: crypto.randomUUID(),
            occurredAt: now.toISOString(),
          },
        },
        recipientUserId: USER_ID,
      },
    ]);
    await service.processSosEvent(crypto.randomUUID());
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      USER_ID,
      'notification.created',
      expect.objectContaining({
        id: NOTIFICATION_ID,
        type: 'sos_alert',
        metadata: expect.objectContaining({ sosEventId: expect.any(String) }),
      }),
    );
  });

  it('runs the SOS post-commit callback before any external FCM attempt', async () => {
    const { repository, firebase, service } = setup();
    repository.createFromSosEvent.mockResolvedValue([
      {
        notification: {
          ...row,
          notification_type: 'sos_alert',
          metadata: { sosEventId: crypto.randomUUID() },
        },
        recipientUserId: USER_ID,
      },
    ]);
    repository.listPendingDeliveries.mockResolvedValue([delivery()]);
    firebase.sendPushNotification.mockResolvedValue({ status: 'success' });
    const afterCommit = jest.fn(() => {
      expect(firebase.sendPushNotification).not.toHaveBeenCalled();
    });
    await service.processSosEvent(crypto.randomUUID(), afterCommit);
    expect(afterCommit).toHaveBeenCalledTimes(1);
    expect(firebase.sendPushNotification).toHaveBeenCalledTimes(1);
  });

  it('uses the persisted notification pipeline for a reminder occurrence', async () => {
    const { repository, realtime, service } = setup();
    repository.createFromReminderLog.mockResolvedValue([
      {
        notification: {
          ...row,
          notification_type: 'reminder',
          metadata: {
            reminderId: crypto.randomUUID(),
            reminderLogId: crypto.randomUUID(),
          },
        },
        recipientUserId: USER_ID,
      },
    ]);
    await service.processReminderLog(crypto.randomUUID());
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      USER_ID,
      'notification.created',
      expect.objectContaining({ type: 'reminder' }),
    );
  });

  it('does not emit or push when notification persistence creates nothing', async () => {
    const { firebase, realtime, service } = setup();
    await service.processGeofenceEvent(crypto.randomUUID());
    expect(realtime.emitToUser).not.toHaveBeenCalled();
    expect(firebase.sendPushNotification).not.toHaveBeenCalled();
  });

  it('records success and sends no coordinates or secrets in FCM data', async () => {
    const { repository, firebase, service } = setup();
    repository.createFromGeofenceEvent.mockResolvedValue([
      { notification: row, recipientUserId: USER_ID },
    ]);
    repository.listPendingDeliveries.mockResolvedValue([delivery()]);
    firebase.sendPushNotification.mockResolvedValue({ status: 'success' });
    await service.processGeofenceEvent(crypto.randomUUID());
    expect(firebase.sendPushNotification).toHaveBeenCalledWith({
      token: 'private-token',
      title: row.title,
      body: row.message,
      data: { notificationId: NOTIFICATION_ID, type: 'geofence_enter' },
    });
    expect(repository.recordDeliveryAttempt).toHaveBeenCalledWith(DELIVERY_ID, {
      status: 'sent',
      errorCategory: undefined,
    });
  });

  it('clears only a permanently invalid token and does not retry it', async () => {
    const { repository, firebase, service } = setup();
    repository.createFromGeofenceEvent.mockResolvedValue([
      { notification: row, recipientUserId: USER_ID },
    ]);
    repository.listPendingDeliveries.mockResolvedValue([delivery()]);
    firebase.sendPushNotification.mockResolvedValue({
      status: 'failure',
      errorCategory: 'invalid_token',
      retryable: false,
      invalidToken: true,
    });
    await service.processGeofenceEvent(crypto.randomUUID());
    expect(firebase.sendPushNotification).toHaveBeenCalledTimes(1);
    expect(repository.clearInvalidToken).toHaveBeenCalledWith(
      DEVICE_ID,
      'private-token',
    );
  });

  it('retries transient failures only up to the bounded attempt limit', async () => {
    const { repository, firebase, service } = setup();
    repository.createFromGeofenceEvent.mockResolvedValue([
      { notification: row, recipientUserId: USER_ID },
    ]);
    repository.listPendingDeliveries.mockResolvedValue([delivery()]);
    firebase.sendPushNotification.mockResolvedValue({
      status: 'failure',
      errorCategory: 'transient',
      retryable: true,
      invalidToken: false,
    });
    await service.processGeofenceEvent(crypto.randomUUID());
    expect(firebase.sendPushNotification).toHaveBeenCalledTimes(2);
    expect(repository.clearInvalidToken).not.toHaveBeenCalled();
    expect(repository.recordDeliveryAttempt).toHaveBeenLastCalledWith(
      DELIVERY_ID,
      { status: 'failed', errorCategory: 'transient' },
    );
  });

  it('attempts every eligible device without duplicating the notification', async () => {
    const { repository, firebase, service } = setup();
    repository.createFromGeofenceEvent.mockResolvedValue([
      { notification: row, recipientUserId: USER_ID },
    ]);
    repository.listPendingDeliveries.mockResolvedValue([
      delivery(),
      {
        ...delivery(),
        id: crypto.randomUUID(),
        device: {
          ...delivery().device,
          id: crypto.randomUUID(),
          fcmToken: 'second-token',
        },
      },
    ]);
    firebase.sendPushNotification.mockResolvedValue({ status: 'success' });
    await service.processGeofenceEvent(crypto.randomUUID());
    expect(repository.createFromGeofenceEvent).toHaveBeenCalledTimes(1);
    expect(firebase.sendPushNotification).toHaveBeenCalledTimes(2);
  });

  it('does not send to inactive devices or devices whose current token is null', async () => {
    const { repository, firebase, service } = setup();
    repository.createFromGeofenceEvent.mockResolvedValue([
      { notification: row, recipientUserId: USER_ID },
    ]);
    repository.listPendingDeliveries.mockResolvedValue([
      { ...delivery(), device: { ...delivery().device, isActive: false } },
      {
        ...delivery(),
        id: crypto.randomUUID(),
        device: { ...delivery().device, fcmToken: null },
      },
    ]);
    await service.processGeofenceEvent(crypto.randomUUID());
    expect(firebase.sendPushNotification).not.toHaveBeenCalled();
    expect(repository.recordDeliveryAttempt).toHaveBeenCalledTimes(2);
  });

  it('rechecks the current push preference before contacting FCM', async () => {
    const { repository, firebase, service } = setup();
    repository.createFromGeofenceEvent.mockResolvedValue([
      { notification: row, recipientUserId: USER_ID },
    ]);
    const disabled = delivery();
    disabled.notification.profiles_notifications_recipient_user_idToprofiles.UserSetting.pushNotificationsEnabled = false;
    repository.listPendingDeliveries.mockResolvedValue([disabled]);
    await service.processGeofenceEvent(crypto.randomUUID());
    expect(firebase.sendPushNotification).not.toHaveBeenCalled();
    expect(repository.recordDeliveryAttempt).toHaveBeenCalledWith(DELIVERY_ID, {
      status: 'failed',
      errorCategory: 'preference_disabled',
    });
  });

  it('keeps all REST reads and read mutations owner-scoped', async () => {
    const { repository, service } = setup();
    await service.getOne(USER_ID, NOTIFICATION_ID);
    await service.markRead(USER_ID, NOTIFICATION_ID);
    await service.markAllRead(USER_ID);
    await service.unreadCount(USER_ID);
    expect(repository.findOwned).toHaveBeenCalledWith(USER_ID, NOTIFICATION_ID);
    expect(repository.markRead).toHaveBeenCalledWith(USER_ID, NOTIFICATION_ID);
    expect(repository.markAllRead).toHaveBeenCalledWith(USER_ID);
    expect(repository.unreadCount).toHaveBeenCalledWith(USER_ID);
    expect(repository.findOwned).not.toHaveBeenCalledWith(
      OTHER_ID,
      NOTIFICATION_ID,
    );
  });

  it('returns stable not-found and invalid-cursor errors', async () => {
    const { repository, service } = setup();
    repository.findOwned.mockResolvedValue(null);
    await expect(
      service.getOne(USER_ID, NOTIFICATION_ID),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.list(USER_ID, { limit: 20, read: 'all', cursor: 'bad' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
