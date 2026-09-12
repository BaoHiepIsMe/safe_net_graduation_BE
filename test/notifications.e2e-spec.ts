import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { NotificationsRepository } from '../src/modules/notifications/notifications.repository';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const FAMILY_ID = '33333333-3333-4333-8333-333333333333';
const NOTIFICATION_A = '44444444-4444-4444-8444-444444444444';
const NOTIFICATION_B = '55555555-5555-4555-8555-555555555555';
const FOREIGN_NOTIFICATION = '66666666-6666-4666-8666-666666666666';

class InMemoryNotificationsRepository {
  private rows = [
    this.row(
      NOTIFICATION_A,
      USER_A,
      false,
      'geofence_enter',
      '2026-08-27T02:00:00Z',
    ),
    this.row(
      NOTIFICATION_B,
      USER_A,
      false,
      'geofence_exit',
      '2026-08-27T01:00:00Z',
    ),
    this.row(
      FOREIGN_NOTIFICATION,
      USER_B,
      false,
      'geofence_enter',
      '2026-08-27T00:00:00Z',
    ),
  ];

  listOwned(userId: string, query: any, cursor?: any) {
    let result = this.rows.filter((row) => row.recipient_user_id === userId);
    if (query.read === 'read') result = result.filter((row) => row.is_read);
    if (query.read === 'unread') result = result.filter((row) => !row.is_read);
    if (query.type)
      result = result.filter((row) => row.notification_type === query.type);
    if (cursor) {
      result = result.filter(
        (row) =>
          row.created_at < cursor.createdAt ||
          (row.created_at.getTime() === cursor.createdAt.getTime() &&
            row.id < cursor.id),
      );
    }
    return Promise.resolve(
      result.slice(0, query.limit + 1).map((row) => this.safe(row)),
    );
  }

  findOwned(userId: string, id: string) {
    const row = this.rows.find(
      (item) => item.id === id && item.recipient_user_id === userId,
    );
    return Promise.resolve(row ? this.safe(row) : null);
  }

  unreadCount(userId: string) {
    return Promise.resolve(
      this.rows.filter(
        (row) => row.recipient_user_id === userId && !row.is_read,
      ).length,
    );
  }

  markAllRead(userId: string) {
    const unread = this.rows.filter(
      (row) => row.recipient_user_id === userId && !row.is_read,
    );
    unread.forEach((row) => {
      row.is_read = true;
      row.read_at = new Date();
    });
    return Promise.resolve({ count: unread.length });
  }

  markRead(userId: string, id: string) {
    const row = this.rows.find(
      (item) => item.id === id && item.recipient_user_id === userId,
    );
    if (!row) return Promise.resolve(null);
    if (!row.is_read) {
      row.is_read = true;
      row.read_at = new Date();
    }
    return Promise.resolve(this.safe(row));
  }

  createFromGeofenceEvent() {
    return Promise.resolve([]);
  }

  listPendingDeliveries() {
    return Promise.resolve([]);
  }

  private row(
    id: string,
    recipient: string,
    read: boolean,
    type: string,
    at: string,
  ) {
    return {
      id,
      recipient_user_id: recipient,
      family_id: FAMILY_ID,
      notification_type: type,
      title: 'Safe-zone update',
      message: 'A family safe-zone transition occurred',
      metadata: { geofenceId: crypto.randomUUID(), transition: type.slice(9) },
      is_read: read,
      read_at: null as Date | null,
      created_at: new Date(at),
    };
  }

  private safe(row: (typeof this.rows)[number]) {
    const { recipient_user_id: _owner, ...safe } = row;
    return safe;
  }
}

describe('Phase 6 Notifications (e2e)', () => {
  let app: INestApplication<App>;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseService)
      .useValue({
        verifyToken: jest.fn((token: string) => {
          const users: Record<string, string> = {
            'token-a': USER_A,
            'token-b': USER_B,
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
      .overrideProvider(NotificationsRepository)
      .useValue(new InMemoryNotificationsRepository())
      .compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  it('requires authentication and returns only owned notifications', async () => {
    await request(app.getHttpServer()).get('/api/v1/notifications').expect(401);
    const response = await request(app.getHttpServer())
      .get('/api/v1/notifications?limit=1&read=unread')
      .set(auth('token-a'))
      .expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination.hasMore).toBe(true);
    expect(response.body.pagination.nextCursor).toEqual(expect.any(String));
    expect(response.body.data[0]).not.toHaveProperty('recipientUserId');
    expect(response.body.data[0]).not.toHaveProperty('deliveries');
    expect(response.body.data[0]).not.toHaveProperty('fcmToken');
  });

  it('uses cursor pagination and durable unread counts', async () => {
    const first = await request(app.getHttpServer())
      .get('/api/v1/notifications?limit=1')
      .set(auth('token-a'))
      .expect(200);
    const second = await request(app.getHttpServer())
      .get(
        `/api/v1/notifications?limit=1&cursor=${first.body.pagination.nextCursor}`,
      )
      .set(auth('token-a'))
      .expect(200);
    expect(second.body.data[0].id).toBe(NOTIFICATION_B);
    const count = await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set(auth('token-a'))
      .expect(200);
    expect(count.body.data.count).toBe(2);
  });

  it('blocks cross-user reads and read mutations with stable not-found responses', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/notifications/${FOREIGN_NOTIFICATION}`)
      .set(auth('token-a'))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${FOREIGN_NOTIFICATION}/read`)
      .set(auth('token-a'))
      .send({})
      .expect(404);
  });

  it('marks one and all notifications read idempotently', async () => {
    const first = await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${NOTIFICATION_A}/read`)
      .set(auth('token-a'))
      .send({})
      .expect(200);
    const repeated = await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${NOTIFICATION_A}/read`)
      .set(auth('token-a'))
      .send({})
      .expect(200);
    expect(repeated.body.data.readAt).toBe(first.body.data.readAt);
    await request(app.getHttpServer())
      .patch('/api/v1/notifications/read-all')
      .set(auth('token-a'))
      .send({})
      .expect(200);
    const repeatedAll = await request(app.getHttpServer())
      .patch('/api/v1/notifications/read-all')
      .set(auth('token-a'))
      .send({})
      .expect(200);
    expect(repeatedAll.body.data.updatedCount).toBe(0);
  });

  it('rejects mass assignment, unknown filters and malformed cursors', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${NOTIFICATION_B}/read`)
      .set(auth('token-a'))
      .send({ isRead: true, readAt: new Date().toISOString() })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/notifications?recipientUserId=anything')
      .set(auth('token-a'))
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/notifications?cursor=not-a-real-cursor')
      .set(auth('token-a'))
      .expect(400);
  });

  afterAll(async () => app.close());
});
