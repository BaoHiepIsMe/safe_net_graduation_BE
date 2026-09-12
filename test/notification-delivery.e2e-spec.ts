import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { FirebaseService } from '../src/infrastructure/firebase/firebase.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { RealtimeGateway } from '../src/infrastructure/realtime/realtime.gateway';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { NotificationsRepository } from '../src/modules/notifications/notifications.repository';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

const RECIPIENT = '11111111-1111-4111-8111-111111111111';
const UNRELATED = '22222222-2222-4222-8222-222222222222';
const FAMILY = '33333333-3333-4333-8333-333333333333';

class OrchestrationRepository {
  events = new Map<string, { authorized: boolean; devices: string[] }>();
  notifications: any[] = [];
  deliveries: any[] = [];

  createFromGeofenceEvent(eventId: string) {
    const event = this.events.get(eventId);
    if (!event?.authorized) return Promise.resolve([]);
    const existing = this.notifications.find((row) => row.source === eventId);
    if (existing) return Promise.resolve([]);
    const notification = {
      id: crypto.randomUUID(),
      source: eventId,
      family_id: FAMILY,
      recipient_user_id: RECIPIENT,
      notification_type: 'geofence_enter',
      title: 'Safe-zone enter',
      message: 'Member entered Home',
      metadata: { geofenceId: crypto.randomUUID(), transition: 'enter' },
      is_read: false,
      read_at: null,
      created_at: new Date(),
    };
    this.notifications.push(notification);
    event.devices.forEach((token, index) =>
      this.deliveries.push({
        id: crypto.randomUUID(),
        notificationId: notification.id,
        status: 'pending',
        attemptCount: 0,
        device: { id: crypto.randomUUID(), fcmToken: token, isActive: true },
        notification: {
          id: notification.id,
          title: notification.title,
          message: notification.message,
          notification_type: notification.notification_type,
          profiles_notifications_recipient_user_idToprofiles: {
            UserSetting: { pushNotificationsEnabled: true },
          },
        },
        index,
      }),
    );
    return Promise.resolve([
      { notification: this.safe(notification), recipientUserId: RECIPIENT },
    ]);
  }

  listPendingDeliveries(notificationId: string) {
    return Promise.resolve(
      this.deliveries.filter(
        (item) =>
          item.notificationId === notificationId && item.status === 'pending',
      ),
    );
  }

  recordDeliveryAttempt(id: string, result: any) {
    const delivery = this.deliveries.find((item) => item.id === id);
    Object.assign(delivery, result, {
      attemptCount: delivery.attemptCount + 1,
    });
    return Promise.resolve(delivery);
  }

  clearInvalidToken() {
    return Promise.resolve({ count: 1 });
  }

  listOwned(userId: string, query: any) {
    return Promise.resolve(
      this.notifications
        .filter((row) => row.recipient_user_id === userId)
        .slice(0, query.limit + 1)
        .map((row) => this.safe(row)),
    );
  }

  findOwned(userId: string, id: string) {
    const row = this.notifications.find(
      (item) => item.id === id && item.recipient_user_id === userId,
    );
    return Promise.resolve(row ? this.safe(row) : null);
  }

  unreadCount(userId: string) {
    return Promise.resolve(
      this.notifications.filter(
        (item) => item.recipient_user_id === userId && !item.is_read,
      ).length,
    );
  }

  markRead(userId: string, id: string) {
    const row = this.notifications.find(
      (item) => item.id === id && item.recipient_user_id === userId,
    );
    if (!row) return Promise.resolve(null);
    if (!row.is_read) {
      row.is_read = true;
      row.read_at = new Date();
    }
    return Promise.resolve(this.safe(row));
  }

  markAllRead() {
    return Promise.resolve({ count: 0 });
  }

  private safe(row: any) {
    const { recipient_user_id: _recipient, source: _source, ...safe } = row;
    return safe;
  }
}

describe('Phase 6 geofence notification delivery (e2e)', () => {
  let app: INestApplication<App>;
  let service: NotificationsService;
  const repository = new OrchestrationRepository();
  const firebase = { sendPushNotification: jest.fn() };
  const realtime = { emitToUser: jest.fn() };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseService)
      .useValue({
        verifyToken: jest.fn((token: string) =>
          Promise.resolve({
            id: token === 'recipient' ? RECIPIENT : UNRELATED,
          }),
        ),
      })
      .overrideProvider(PrismaService)
      .useValue({
        profile: { findFirst: jest.fn(), findUnique: jest.fn() },
        familyMember: { findFirst: jest.fn() },
        conversationMember: { findFirst: jest.fn() },
      })
      .overrideProvider(NotificationsRepository)
      .useValue(repository)
      .overrideProvider(FirebaseService)
      .useValue(firebase)
      .overrideProvider(RealtimeGateway)
      .useValue(realtime)
      .compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    service = app.get(NotificationsService);
  });

  it('A: persists an authorized event notification, lists it, counts it and marks it read', async () => {
    const eventId = crypto.randomUUID();
    repository.events.set(eventId, { authorized: true, devices: [] });
    await service.processGeofenceEvent(eventId);
    expect(repository.notifications).toHaveLength(1);
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      RECIPIENT,
      'notification.created',
      expect.objectContaining({ id: repository.notifications[0].id }),
    );
    await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set(auth('recipient'))
      .expect(200)
      .expect((response) => expect(response.body.data).toHaveLength(1));
    await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set(auth('recipient'))
      .expect(200)
      .expect((response) => expect(response.body.data.count).toBe(1));
    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${repository.notifications[0].id}/read`)
      .set(auth('recipient'))
      .send({})
      .expect(200);
  });

  it('B/C/D: suppresses duplicate and privacy-disabled processing and blocks unrelated access', async () => {
    const authorizedEvent = repository.notifications[0].source;
    await service.processGeofenceEvent(authorizedEvent);
    expect(repository.notifications).toHaveLength(1);
    const deniedEvent = crypto.randomUUID();
    repository.events.set(deniedEvent, { authorized: false, devices: [] });
    await service.processGeofenceEvent(deniedEvent);
    expect(repository.notifications).toHaveLength(1);
    await request(app.getHttpServer())
      .get(`/api/v1/notifications/${repository.notifications[0].id}`)
      .set(auth('unrelated'))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${repository.notifications[0].id}/read`)
      .set(auth('unrelated'))
      .send({})
      .expect(404);
  });

  it('E: stores one user notification and attempts both current device tokens', async () => {
    const eventId = crypto.randomUUID();
    repository.events.set(eventId, {
      authorized: true,
      devices: ['token-one', 'token-two'],
    });
    firebase.sendPushNotification.mockResolvedValue({ status: 'success' });
    await service.processGeofenceEvent(eventId);
    expect(
      repository.notifications.filter((row) => row.source === eventId),
    ).toHaveLength(1);
    expect(
      repository.deliveries.filter(
        (row) => row.notificationId === repository.notifications[1].id,
      ),
    ).toHaveLength(2);
    expect(firebase.sendPushNotification).toHaveBeenCalledTimes(2);
  });

  it('F: retains the API notification when every FCM attempt fails', async () => {
    const eventId = crypto.randomUUID();
    repository.events.set(eventId, {
      authorized: true,
      devices: ['failing-token'],
    });
    firebase.sendPushNotification.mockResolvedValue({
      status: 'failure',
      errorCategory: 'permanent',
      retryable: false,
      invalidToken: false,
    });
    await service.processGeofenceEvent(eventId);
    const notification = repository.notifications.find(
      (row) => row.source === eventId,
    );
    expect(notification).toBeDefined();
    await request(app.getHttpServer())
      .get(`/api/v1/notifications/${notification.id}`)
      .set(auth('recipient'))
      .expect(200);
  });

  afterAll(async () => app.close());
});
