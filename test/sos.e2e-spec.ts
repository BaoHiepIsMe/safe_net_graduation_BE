import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { FirebaseService } from '../src/infrastructure/firebase/firebase.service';
import { RealtimeGateway } from '../src/infrastructure/realtime/realtime.gateway';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { NotificationsRepository } from '../src/modules/notifications/notifications.repository';
import { SosRepository } from '../src/modules/sos/sos.repository';
import { AppModule } from '../src/app.module';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';
const DEVICE_A = '44444444-4444-4444-8444-444444444444';

class InMemorySosRepository {
  events: any[] = [];
  contacts: any[] = [];
  hasLocation = true;

  trigger(actorUserId: string, dto: any, requestFingerprint: string) {
    const reused = this.events.find(
      (event) =>
        event.actorUserId === actorUserId &&
        event.clientRequestId === dto.clientRequestId,
    );
    if (reused) {
      return Promise.resolve(
        reused.requestFingerprint === requestFingerprint
          ? { outcome: 'reused', event: reused }
          : { outcome: 'idempotency_conflict' },
      );
    }
    const active = this.events.find(
      (event) => event.actorUserId === actorUserId && event.status === 'active',
    );
    if (active)
      return Promise.resolve({ outcome: 'already_active', eventId: active.id });
    if (dto.deviceId && dto.deviceId !== DEVICE_A)
      return Promise.resolve({ outcome: 'invalid_device' });
    const at = new Date();
    const event = {
      id: crypto.randomUUID(),
      actorUserId,
      clientRequestId: dto.clientRequestId,
      requestFingerprint,
      status: 'active',
      latitude: this.hasLocation ? 10.7 : null,
      longitude: this.hasLocation ? 106.6 : null,
      locationAccuracy: this.hasLocation ? 5 : null,
      locationRecordedAt: this.hasLocation ? at : null,
      note: dto.message ?? null,
      triggeredAt: at,
      resolvedAt: null,
      cancelledAt: null,
      actor: { id: USER_A, fullName: 'User A', avatarUrl: null },
      recipients: [{ recipientUserId: USER_A }, { recipientUserId: USER_B }],
    };
    this.events.push(event);
    return Promise.resolve({ outcome: 'created', event });
  }

  listHistory(actorUserId: string, query: any, cursor?: any) {
    let rows = this.events.filter((event) => event.actorUserId === actorUserId);
    if (query.status)
      rows = rows.filter((event) => event.status === query.status);
    if (cursor) {
      rows = rows.filter(
        (event) =>
          event.triggeredAt < cursor.triggeredAt ||
          (event.triggeredAt.getTime() === cursor.triggeredAt.getTime() &&
            event.id < cursor.id),
      );
    }
    return Promise.resolve(rows.slice(0, query.limit + 1));
  }

  findAuthorized(userId: string, eventId: string) {
    return Promise.resolve(
      this.events.find(
        (event) =>
          event.id === eventId &&
          (event.actorUserId === userId ||
            event.recipients.some(
              (item: any) => item.recipientUserId === userId,
            )),
      ) ?? null,
    );
  }

  transition(actorUserId: string, eventId: string, target: string) {
    const event = this.events.find(
      (item) => item.id === eventId && item.actorUserId === actorUserId,
    );
    if (!event) return Promise.resolve({ outcome: 'not_found' });
    if (event.status === target)
      return Promise.resolve({ outcome: 'unchanged', event });
    if (event.status !== 'active') {
      return Promise.resolve({
        outcome: 'invalid_state',
        currentStatus: event.status,
      });
    }
    event.status = target;
    if (target === 'resolved') event.resolvedAt = new Date();
    if (target === 'cancelled') event.cancelledAt = new Date();
    return Promise.resolve({ outcome: 'updated', event });
  }

  createContact(ownerUserId: string, dto: any) {
    if (dto.contactUserId && dto.contactUserId !== USER_B)
      return Promise.resolve({ outcome: 'invalid_link' });
    if (
      this.contacts.some(
        (contact) =>
          contact.ownerUserId === ownerUserId && contact.phone === dto.phone,
      )
    ) {
      return Promise.resolve({ outcome: 'duplicate' });
    }
    const now = new Date();
    const contact = {
      id: crypto.randomUUID(),
      ownerUserId,
      contactName: dto.contactName,
      phone: dto.phone,
      priority: dto.priority,
      isActive: true,
      linkedUser: dto.contactUserId
        ? { id: USER_B, fullName: 'User B', avatarUrl: null }
        : null,
      createdAt: now,
      updatedAt: now,
    };
    this.contacts.push(contact);
    return Promise.resolve({
      outcome: 'created',
      contact: this.safeContact(contact),
    });
  }

  listContacts(ownerUserId: string, query: any) {
    const rows = this.contacts
      .filter(
        (contact) =>
          contact.ownerUserId === ownerUserId &&
          (query.active === undefined || contact.isActive === query.active),
      )
      .map((contact) => this.safeContact(contact));
    return Promise.resolve({ rows, total: rows.length });
  }

  updateContact(ownerUserId: string, contactId: string, dto: any) {
    const contact = this.contacts.find(
      (item) => item.id === contactId && item.ownerUserId === ownerUserId,
    );
    if (!contact) return Promise.resolve({ outcome: 'not_found' });
    Object.assign(contact, dto, { updatedAt: new Date() });
    return Promise.resolve({
      outcome: 'updated',
      contact: this.safeContact(contact),
    });
  }

  deleteContact(ownerUserId: string, contactId: string) {
    const index = this.contacts.findIndex(
      (item) => item.id === contactId && item.ownerUserId === ownerUserId,
    );
    if (index < 0) return Promise.resolve({ count: 0 });
    this.contacts.splice(index, 1);
    return Promise.resolve({ count: 1 });
  }

  private safeContact(contact: any) {
    const { ownerUserId: _owner, ...safe } = contact;
    return safe;
  }
}

class InMemoryNotificationsRepository {
  notifications: any[] = [];
  deliveries: any[] = [];
  constructor(private readonly sos: InMemorySosRepository) {}

  createFromSosEvent(eventId: string) {
    const event = this.sos.events.find((item) => item.id === eventId);
    if (!event) return Promise.resolve([]);
    const created: any[] = [];
    event.recipients.forEach((recipient: any) => {
      if (
        this.notifications.some(
          (notification) =>
            notification.recipient_user_id === recipient.recipientUserId &&
            notification.sourceEventId === eventId,
        )
      )
        return;
      const notification = {
        id: crypto.randomUUID(),
        recipient_user_id: recipient.recipientUserId,
        sourceEventId: eventId,
        family_id: null,
        notification_type: 'sos_alert',
        title: 'Emergency SOS',
        message: 'User A needs help.',
        metadata: {
          sosEventId: eventId,
          occurredAt: event.triggeredAt.toISOString(),
        },
        is_read: false,
        read_at: null,
        created_at: new Date(),
      };
      this.notifications.push(notification);
      const tokenCount = recipient.recipientUserId === USER_B ? 3 : 1;
      for (let index = 0; index < tokenCount; index++) {
        this.deliveries.push({
          id: crypto.randomUUID(),
          notificationId: notification.id,
          status: 'pending',
          attemptCount: 0,
          device: {
            id: crypto.randomUUID(),
            fcmToken: `safe-token-${recipient.recipientUserId}-${index}`,
            isActive: true,
          },
          notification: {
            id: notification.id,
            title: notification.title,
            message: notification.message,
            notification_type: notification.notification_type,
            profiles_notifications_recipient_user_idToprofiles: {
              UserSetting: { pushNotificationsEnabled: true },
            },
          },
        });
      }
      created.push({
        notification: this.safe(notification),
        recipientUserId: recipient.recipientUserId,
      });
    });
    return Promise.resolve(created);
  }

  createFromGeofenceEvent() {
    return Promise.resolve([]);
  }

  listPendingDeliveries(notificationId: string) {
    return Promise.resolve(
      this.deliveries.filter(
        (delivery) =>
          delivery.notificationId === notificationId &&
          delivery.status === 'pending',
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
        .filter(
          (row) =>
            row.recipient_user_id === userId &&
            (query.read === 'all' ||
              (query.read === 'read' && row.is_read) ||
              (query.read === 'unread' && !row.is_read)) &&
            (!query.type || row.notification_type === query.type),
        )
        .slice(0, query.limit + 1)
        .map((row) => this.safe(row)),
    );
  }

  findOwned(userId: string, notificationId: string) {
    const row = this.notifications.find(
      (item) => item.id === notificationId && item.recipient_user_id === userId,
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

  markRead(userId: string, notificationId: string) {
    const row = this.notifications.find(
      (item) => item.id === notificationId && item.recipient_user_id === userId,
    );
    if (!row) return Promise.resolve(null);
    if (!row.is_read) {
      row.is_read = true;
      row.read_at = new Date();
    }
    return Promise.resolve(this.safe(row));
  }

  markAllRead(userId: string) {
    let count = 0;
    this.notifications.forEach((row) => {
      if (row.recipient_user_id === userId && !row.is_read) {
        row.is_read = true;
        row.read_at = new Date();
        count++;
      }
    });
    return Promise.resolve({ count });
  }

  private safe(row: any) {
    const {
      recipient_user_id: _recipient,
      sourceEventId: _source,
      ...safe
    } = row;
    return safe;
  }
}

describe('Phase 7 SOS / Emergency (e2e)', () => {
  let app: INestApplication<App>;
  const sos = new InMemorySosRepository();
  const notifications = new InMemoryNotificationsRepository(sos);
  const firebase = { sendPushNotification: jest.fn() };
  const realtime = { emitToUser: jest.fn() };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    firebase.sendPushNotification.mockResolvedValue({ status: 'success' });
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseService)
      .useValue({
        verifyToken: jest.fn((token: string) => {
          const users: Record<string, string> = {
            'token-a': USER_A,
            'token-b': USER_B,
            'token-c': USER_C,
          };
          return Promise.resolve(users[token] ? { id: users[token] } : null);
        }),
      })
      .overrideProvider(PrismaService)
      .useValue({
        profile: { findFirst: jest.fn(), findUnique: jest.fn() },
        familyMember: { findFirst: jest.fn() },
        conversationMember: { findFirst: jest.fn() },
      })
      .overrideProvider(SosRepository)
      .useValue(sos)
      .overrideProvider(NotificationsRepository)
      .useValue(notifications)
      .overrideProvider(FirebaseService)
      .useValue(firebase)
      .overrideProvider(RealtimeGateway)
      .useValue(realtime)
      .compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  let firstEventId: string;
  let firstRequestId: string;

  it('A: creates a located manual SOS and one authorized notification with three device deliveries', async () => {
    firstRequestId = crypto.randomUUID();
    const response = await request(app.getHttpServer())
      .post('/api/v1/sos')
      .set(auth('token-a'))
      .send({
        clientRequestId: firstRequestId,
        deviceId: DEVICE_A,
        message: 'Help me',
      })
      .expect(201);
    firstEventId = response.body.data.id;
    expect(response.body.data.location).toMatchObject({ available: true });
    const recipientNotifications = notifications.notifications.filter(
      (item) =>
        item.recipient_user_id === USER_B &&
        item.sourceEventId === firstEventId,
    );
    expect(recipientNotifications).toHaveLength(1);
    expect(
      notifications.deliveries.filter(
        (item) => item.notificationId === recipientNotifications[0].id,
      ),
    ).toHaveLength(3);
    await request(app.getHttpServer())
      .get('/api/v1/notifications?type=sos_alert')
      .set(auth('token-b'))
      .expect(200)
      .expect((result) => expect(result.body.data).toHaveLength(1));
    await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set(auth('token-b'))
      .expect(200)
      .expect((result) => expect(result.body.data.count).toBe(1));
  });

  it('B: reuses the same request ID without duplicate SOS or notifications', async () => {
    const repeated = await request(app.getHttpServer())
      .post('/api/v1/sos')
      .set(auth('token-a'))
      .send({
        clientRequestId: firstRequestId,
        deviceId: DEVICE_A,
        message: 'Help me',
      })
      .expect(201);
    expect(repeated.body.data.id).toBe(firstEventId);
    expect(
      sos.events.filter((event) => event.id === firstEventId),
    ).toHaveLength(1);
    expect(
      notifications.notifications.filter(
        (item) =>
          item.sourceEventId === firstEventId &&
          item.recipient_user_id === USER_B,
      ),
    ).toHaveLength(1);
  });

  it('C/F: accepts no-location SOS after resolution and enforces terminal state transitions', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/sos/${firstEventId}/resolve`)
      .set(auth('token-a'))
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/sos/${firstEventId}/resolve`)
      .set(auth('token-a'))
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/sos/${firstEventId}/cancel`)
      .set(auth('token-a'))
      .send({})
      .expect(422);

    sos.hasLocation = false;
    const noLocation = await request(app.getHttpServer())
      .post('/api/v1/sos')
      .set(auth('token-a'))
      .send({ clientRequestId: crypto.randomUUID() })
      .expect(201);
    expect(noLocation.body.data.location).toEqual({
      available: false,
      latitude: null,
      longitude: null,
      accuracy: null,
      recordedAt: null,
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/sos/${noLocation.body.data.id}/cancel`)
      .set(auth('token-a'))
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/sos/${noLocation.body.data.id}/resolve`)
      .set(auth('token-a'))
      .send({})
      .expect(422);
  });

  it('D: unrelated users cannot read or mutate SOS and receive no notification', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/sos/${firstEventId}`)
      .set(auth('token-c'))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/sos/${firstEventId}/resolve`)
      .set(auth('token-c'))
      .send({})
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/sos/${firstEventId}/cancel`)
      .set(auth('token-c'))
      .send({})
      .expect(404);
    expect(
      notifications.notifications.filter(
        (item) => item.recipient_user_id === USER_C,
      ),
    ).toHaveLength(0);
  });

  it('E: retains SOS and Notification when mocked FCM delivery fails', async () => {
    firebase.sendPushNotification.mockResolvedValue({
      status: 'failure',
      errorCategory: 'permanent',
      retryable: false,
      invalidToken: false,
    });
    sos.hasLocation = true;
    const response = await request(app.getHttpServer())
      .post('/api/v1/sos')
      .set(auth('token-a'))
      .send({ clientRequestId: crypto.randomUUID() })
      .expect(201);
    const eventId = response.body.data.id;
    expect(sos.events.some((event) => event.id === eventId)).toBe(true);
    expect(
      notifications.notifications.some(
        (item) =>
          item.sourceEventId === eventId && item.recipient_user_id === USER_B,
      ),
    ).toBe(true);
  });

  it('G: emergency contact CRUD and ownership are enforced', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/sos/contacts')
      .set(auth('token-a'))
      .send({
        contactName: 'Parent',
        phone: '+84 912 345 678',
        contactUserId: USER_B,
        priority: 1,
      })
      .expect(201);
    const contactId = created.body.data.id;
    await request(app.getHttpServer())
      .get('/api/v1/sos/contacts')
      .set(auth('token-a'))
      .expect(200)
      .expect((result) => expect(result.body.data).toHaveLength(1));
    await request(app.getHttpServer())
      .patch(`/api/v1/sos/contacts/${contactId}`)
      .set(auth('token-b'))
      .send({ contactName: 'Stolen' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/sos/contacts/${contactId}`)
      .set(auth('token-b'))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/sos/contacts/${contactId}`)
      .set(auth('token-a'))
      .send({ contactName: 'Updated Parent' })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/v1/sos/contacts/${contactId}`)
      .set(auth('token-a'))
      .expect(204);
  });

  it('serializes concurrent retries into one logical SOS incident', async () => {
    for (const event of sos.events.filter((item) => item.status === 'active')) {
      event.status = 'resolved';
      event.resolvedAt = new Date();
    }
    const key = crypto.randomUUID();
    const body = { clientRequestId: key, message: 'Concurrent retry' };
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/sos')
        .set(auth('token-a'))
        .send(body)
        .expect(201),
      request(app.getHttpServer())
        .post('/api/v1/sos')
        .set(auth('token-a'))
        .send(body)
        .expect(201),
    ]);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(
      sos.events.filter((event) => event.clientRequestId === key),
    ).toHaveLength(1);
    expect(
      notifications.notifications.filter(
        (item) =>
          item.sourceEventId === first.body.data.id &&
          item.recipient_user_id === USER_B,
      ),
    ).toHaveLength(1);
  });

  it('rejects spoofing, foreign devices, and conflicting idempotency payloads', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/sos')
      .set(auth('token-a'))
      .send({ clientRequestId: crypto.randomUUID(), userId: USER_B })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/sos')
      .set(auth('token-a'))
      .send({ clientRequestId: crypto.randomUUID(), recipientIds: [USER_C] })
      .expect(400);
    sos.events.find((event) => event.status === 'active')!.status = 'resolved';
    await request(app.getHttpServer())
      .post('/api/v1/sos')
      .set(auth('token-a'))
      .send({
        clientRequestId: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
      })
      .expect(404);
    const key = crypto.randomUUID();
    await request(app.getHttpServer())
      .post('/api/v1/sos')
      .set(auth('token-a'))
      .send({ clientRequestId: key, message: 'first' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/sos')
      .set(auth('token-a'))
      .send({ clientRequestId: key, message: 'changed' })
      .expect(409);
  });

  afterAll(async () => app.close());
});
