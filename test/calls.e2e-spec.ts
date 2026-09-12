import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { RealtimeGateway } from '../src/infrastructure/realtime/realtime.gateway';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { CallsRepository } from '../src/modules/calls/calls.repository';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const FAMILY = '44444444-4444-4444-8444-444444444444';
const DIRECT = '55555555-5555-4555-8555-555555555555';
const GROUP = '66666666-6666-4666-8666-666666666666';

class InMemoryCallsRepository {
  calls: any[] = [];
  status = new Map([
    [A, 'accepted'],
    [B, 'accepted'],
    [C, 'unrelated'],
  ]);
  active = new Set<string>();

  private allowed(userId: string) {
    return this.status.get(userId) === 'accepted';
  }
  private row(overrides: Record<string, unknown> = {}) {
    const now = new Date();
    return {
      id: crypto.randomUUID(),
      familyId: FAMILY,
      conversationId: DIRECT,
      callerUserId: A,
      calleeUserId: B,
      clientRequestId: crypto.randomUUID(),
      requestFingerprint: '',
      callType: 'voice',
      status: 'ringing',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 45_000),
      acceptedAt: null,
      terminalAt: null,
      updatedAt: now,
      caller: { id: A, fullName: 'A', avatarUrl: null },
      callee: { id: B, fullName: 'B', avatarUrl: null },
      ...overrides,
    };
  }
  create(
    caller: string,
    conversationId: string,
    dto: any,
    fingerprint: string,
    expiresAt: Date,
  ) {
    const existing = this.calls.find(
      (call) =>
        call.callerUserId === caller &&
        call.clientRequestId === dto.clientRequestId,
    );
    if (existing)
      return Promise.resolve(
        existing.requestFingerprint === fingerprint
          ? { outcome: 'reused', call: existing }
          : { outcome: 'conflict' },
      );
    if (conversationId === GROUP) return Promise.resolve({ outcome: 'group' });
    if (
      conversationId !== DIRECT ||
      caller !== A ||
      !this.allowed(A) ||
      !this.allowed(B)
    )
      return Promise.resolve({ outcome: 'forbidden' });
    if (this.active.has(A) || this.active.has(B))
      return Promise.resolve({ outcome: 'busy' });
    const call = this.row({
      clientRequestId: dto.clientRequestId,
      requestFingerprint: fingerprint,
      callType: dto.callType,
      expiresAt,
    });
    this.calls.push(call);
    this.active.add(A);
    this.active.add(B);
    return Promise.resolve({ outcome: 'created', call });
  }
  transition(userId: string, callId: string, action: string, now: Date) {
    const call = this.calls.find(
      (item) =>
        item.id === callId &&
        [item.callerUserId, item.calleeUserId].includes(userId),
    );
    if (!call) return Promise.resolve({ outcome: 'not_found' });
    const target: Record<string, string> = {
      accept: 'accepted',
      reject: 'rejected',
      cancel: 'cancelled',
      end: 'ended',
    };
    const desired = target[action];
    const actorAllowed =
      action === 'accept' || action === 'reject'
        ? userId === call.calleeUserId
        : action === 'cancel'
          ? userId === call.callerUserId
          : true;
    if (!actorAllowed) return Promise.resolve({ outcome: 'forbidden' });
    if (call.status === desired)
      return Promise.resolve({ outcome: 'unchanged', call });
    if (
      (action === 'accept' || action === 'reject') &&
      (!this.allowed(A) || !this.allowed(B))
    )
      return Promise.resolve({ outcome: 'forbidden' });
    if (call.status === 'ringing' && call.expiresAt <= now) {
      Object.assign(call, {
        status: 'missed',
        terminalAt: now,
        updatedAt: now,
      });
      this.active.delete(A);
      this.active.delete(B);
      return Promise.resolve({ outcome: 'expired', call });
    }
    const valid =
      call.status === 'ringing'
        ? ['accepted', 'rejected', 'cancelled'].includes(desired)
        : call.status === 'accepted' && desired === 'ended';
    if (!valid) return Promise.resolve({ outcome: 'invalid_state', call });
    Object.assign(call, {
      status: desired,
      acceptedAt: desired === 'accepted' ? now : call.acceptedAt,
      terminalAt: ['rejected', 'cancelled', 'ended'].includes(desired)
        ? now
        : call.terminalAt,
      updatedAt: now,
    });
    if (['rejected', 'cancelled', 'ended'].includes(desired)) {
      this.active.delete(A);
      this.active.delete(B);
    }
    return Promise.resolve({ outcome: 'updated', call });
  }
  listOwned(userId: string, query: any) {
    return Promise.resolve(
      this.calls
        .filter((c) => c.callerUserId === userId || c.calleeUserId === userId)
        .slice()
        .reverse()
        .slice(0, query.limit + 1),
    );
  }
  findOwned(userId: string, callId: string) {
    return Promise.resolve(
      this.calls.find(
        (c) =>
          c.id === callId &&
          (c.callerUserId === userId || c.calleeUserId === userId),
      ) ?? null,
    );
  }
  resolveCurrentParticipants(callId: string) {
    const call = this.calls.find((c) => c.id === callId);
    return Promise.resolve(
      call && this.allowed(A) && this.allowed(B)
        ? { call, userIds: [A, B] }
        : null,
    );
  }
  authorizeSignal(userId: string, callId: string, signalType: string) {
    const call = this.calls.find((c) => c.id === callId);
    if (
      !call ||
      !this.allowed(A) ||
      !this.allowed(B) ||
      !['ringing', 'accepted'].includes(call.status) ||
      ![A, B].includes(userId)
    )
      return Promise.resolve(null);
    if (signalType === 'offer' && userId !== A) return Promise.resolve(null);
    if (signalType === 'answer' && (userId !== B || call.status !== 'accepted'))
      return Promise.resolve(null);
    return Promise.resolve({ call, targetUserId: userId === A ? B : A });
  }
  expireDue() {
    return Promise.resolve([]);
  }
}

describe('Phase 13 Calls/Signaling (e2e)', () => {
  let app: INestApplication<App>;
  let repository: InMemoryCallsRepository;
  const notifications = { processCall: jest.fn().mockResolvedValue([]) };
  const realtime = { emitToUser: jest.fn() };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    repository = new InMemoryCallsRepository();
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseService)
      .useValue({
        verifyToken: jest.fn((token: string) =>
          Promise.resolve({ id: token === 'a' ? A : token === 'b' ? B : C }),
        ),
      })
      .overrideProvider(PrismaService)
      .useValue({
        profile: { findUnique: jest.fn() },
        familyMember: { findFirst: jest.fn() },
        conversationMember: { findFirst: jest.fn() },
      })
      .overrideProvider(CallsRepository)
      .useValue(repository)
      .overrideProvider(NotificationsService)
      .useValue(notifications)
      .overrideProvider(RealtimeGateway)
      .useValue(realtime)
      .compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  it('A: voice Call persists ringing, callee accepts, participant ends, history remains', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${DIRECT}/calls`)
      .set(auth('a'))
      .send({ clientRequestId: crypto.randomUUID(), callType: 'voice' })
      .expect(201);
    expect(created.body.data.status).toBe('ringing');
    const callId = created.body.data.id;
    await request(app.getHttpServer())
      .post(`/api/v1/calls/${callId}/accept`)
      .set(auth('b'))
      .send({})
      .expect(200)
      .expect((r) => expect(r.body.data.status).toBe('accepted'));
    await request(app.getHttpServer())
      .post(`/api/v1/calls/${callId}/end`)
      .set(auth('a'))
      .send({})
      .expect(200)
      .expect((r) => expect(r.body.data.status).toBe('ended'));
    await request(app.getHttpServer())
      .get('/api/v1/calls')
      .set(auth('b'))
      .expect(200)
      .expect((r) =>
        expect(r.body.data.map((x: any) => x.id)).toContain(callId),
      );
  });

  it('B: callee may reject while caller may not self-accept', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${DIRECT}/calls`)
      .set(auth('a'))
      .send({ clientRequestId: crypto.randomUUID(), callType: 'video' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/calls/${created.body.data.id}/accept`)
      .set(auth('a'))
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/calls/${created.body.data.id}/reject`)
      .set(auth('b'))
      .send({})
      .expect(200)
      .expect((r) => expect(r.body.data.status).toBe('rejected'));
  });

  it('C: caller cancels before acceptance', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${DIRECT}/calls`)
      .set(auth('a'))
      .send({ clientRequestId: crypto.randomUUID(), callType: 'voice' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/calls/${created.body.data.id}/cancel`)
      .set(auth('a'))
      .send({})
      .expect(200)
      .expect((r) => expect(r.body.data.status).toBe('cancelled'));
  });

  it('D: idempotent retry creates one Call and one incoming Notification', async () => {
    const requestId = crypto.randomUUID();
    const beforeCalls = repository.calls.length;
    const beforeNotifications = notifications.processCall.mock.calls.length;
    const first = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${DIRECT}/calls`)
      .set(auth('a'))
      .send({ clientRequestId: requestId, callType: 'voice' })
      .expect(201);
    const retry = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${DIRECT}/calls`)
      .set(auth('a'))
      .send({ clientRequestId: requestId, callType: 'voice' })
      .expect(201);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(repository.calls).toHaveLength(beforeCalls + 1);
    expect(notifications.processCall.mock.calls.length).toBe(
      beforeNotifications + 1,
    );
    await request(app.getHttpServer())
      .post(`/api/v1/calls/${first.body.data.id}/cancel`)
      .set(auth('a'))
      .send({})
      .expect(200);
  });

  it('E: unrelated user cannot read or mutate a Call', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${DIRECT}/calls`)
      .set(auth('a'))
      .send({ clientRequestId: crypto.randomUUID(), callType: 'voice' })
      .expect(201);
    const id = created.body.data.id;
    await request(app.getHttpServer())
      .get(`/api/v1/calls/${id}`)
      .set(auth('c'))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/calls/${id}/accept`)
      .set(auth('c'))
      .send({})
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/calls/${id}/cancel`)
      .set(auth('a'))
      .send({})
      .expect(200);
  });

  it('F: Notification/FCM failure leaves the Call ringing', async () => {
    notifications.processCall.mockRejectedValueOnce(
      new Error('FCM unavailable'),
    );
    const created = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${DIRECT}/calls`)
      .set(auth('a'))
      .send({ clientRequestId: crypto.randomUUID(), callType: 'video' })
      .expect(201);
    expect(created.body.data.status).toBe('ringing');
    expect(
      repository.calls.find((c) => c.id === created.body.data.id)?.status,
    ).toBe('ringing');
    await request(app.getHttpServer())
      .post(`/api/v1/calls/${created.body.data.id}/cancel`)
      .set(auth('a'))
      .send({})
      .expect(200);
  });

  it('G: Family removal blocks new Call acceptance and signaling authorization', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${DIRECT}/calls`)
      .set(auth('a'))
      .send({ clientRequestId: crypto.randomUUID(), callType: 'voice' })
      .expect(201);
    repository.status.set(B, 'removed');
    await request(app.getHttpServer())
      .post(`/api/v1/calls/${created.body.data.id}/accept`)
      .set(auth('b'))
      .send({})
      .expect(403);
    await expect(
      repository.authorizeSignal(B, created.body.data.id, 'ice_candidate'),
    ).resolves.toBeNull();
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${DIRECT}/calls`)
      .set(auth('a'))
      .send({ clientRequestId: crypto.randomUUID(), callType: 'voice' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/calls/${created.body.data.id}/cancel`)
      .set(auth('a'))
      .send({})
      .expect(200);
    repository.status.set(B, 'accepted');
  });

  it('H: group Calls and client-controlled lifecycle fields are rejected', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${GROUP}/calls`)
      .set(auth('a'))
      .send({ clientRequestId: crypto.randomUUID(), callType: 'voice' })
      .expect(422);
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${DIRECT}/calls`)
      .set(auth('a'))
      .send({
        clientRequestId: crypto.randomUUID(),
        callType: 'voice',
        callerId: C,
      })
      .expect(400);
  });

  afterAll(async () => app.close());
});
