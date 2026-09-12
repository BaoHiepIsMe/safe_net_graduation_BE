import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { RealtimeGateway } from '../src/infrastructure/realtime/realtime.gateway';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { ChatRepository } from '../src/modules/chat/chat.repository';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const FAMILY = '44444444-4444-4444-8444-444444444444';
const MEMBER_B = '55555555-5555-4555-8555-555555555555';
const MEMBER_C = '66666666-6666-4666-8666-666666666666';

class InMemoryChatRepository {
  status = new Map([
    [A, 'accepted'],
    [B, 'accepted'],
    [C, 'unrelated'],
  ]);
  role = new Map([
    [A, 'manager'],
    [B, 'adult'],
  ]);
  conversations: any[] = [];
  messages: any[] = [];

  private memberIdUser(id: string) {
    return id === MEMBER_B ? B : id === MEMBER_C ? C : null;
  }
  private allowed(userId: string, conversation: any) {
    return (
      this.status.get(userId) === 'accepted' &&
      conversation.activeMembers.has(userId)
    );
  }
  private row(conversation: any) {
    return {
      id: conversation.id,
      familyId: FAMILY,
      type: conversation.type,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: this.messages
        .filter((m) => m.conversationId === conversation.id)
        .slice(-1)
        .reverse(),
    };
  }
  getOrCreateDirect(actor: string, familyId: string, targetMemberId: string) {
    const target = this.memberIdUser(targetMemberId);
    if (
      familyId !== FAMILY ||
      this.status.get(actor) !== 'accepted' ||
      !target ||
      this.status.get(target) !== 'accepted'
    )
      return Promise.resolve({ outcome: 'forbidden' });
    const existing = this.conversations.find(
      (c) =>
        c.type === 'direct' &&
        c.activeMembers.has(actor) &&
        c.activeMembers.has(target),
    );
    if (existing)
      return Promise.resolve({
        outcome: 'existing',
        conversationId: existing.id,
      });
    const now = new Date();
    const conversation = {
      id: crypto.randomUUID(),
      type: 'direct',
      title: null,
      activeMembers: new Set([actor, target]),
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.push(conversation);
    return Promise.resolve({
      outcome: 'created',
      conversationId: conversation.id,
    });
  }
  createGroup(actor: string, familyId: string, dto: any) {
    const users = dto.memberIds.map((id: string) => this.memberIdUser(id));
    if (
      familyId !== FAMILY ||
      this.status.get(actor) !== 'accepted' ||
      this.role.get(actor) !== 'manager'
    )
      return Promise.resolve({ outcome: 'forbidden' });
    if (
      users.some(
        (user: string | null) => !user || this.status.get(user) !== 'accepted',
      )
    )
      return Promise.resolve({ outcome: 'invalid_target' });
    const now = new Date();
    const conversation = {
      id: crypto.randomUUID(),
      type: 'group',
      title: dto.title,
      activeMembers: new Set([actor, ...users]),
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.push(conversation);
    return Promise.resolve({
      outcome: 'created',
      conversationId: conversation.id,
    });
  }
  detail(userId: string, conversationId: string) {
    const conversation = this.conversations.find(
      (c) => c.id === conversationId,
    );
    if (!conversation || !this.allowed(userId, conversation))
      return Promise.resolve(null);
    return Promise.resolve({
      access: { conversation: this.row(conversation) },
      members: [...conversation.activeMembers]
        .filter((id) => this.status.get(id) === 'accepted')
        .map((id) => ({
          userId: id,
          joinedAt: conversation.createdAt,
          profile: { fullName: id === A ? 'A' : 'B', avatarUrl: null },
        })),
      unreadCount: this.messages.filter(
        (m) => m.conversationId === conversationId && m.senderUserId !== userId,
      ).length,
    });
  }
  listVisible(userId: string) {
    return Promise.resolve(
      this.conversations
        .filter((c) => this.allowed(userId, c))
        .map((c) => ({
          conversation: { ...this.row(c), members: [] },
          unreadCount: 0,
        })),
    );
  }
  listMembers(userId: string, conversationId: string) {
    return this.detail(userId, conversationId).then((x) => x?.members ?? null);
  }
  addGroupMember(actor: string, conversationId: string, memberId: string) {
    const c = this.conversations.find(
      (x) => x.id === conversationId && x.type === 'group',
    );
    const target = this.memberIdUser(memberId);
    if (
      !c ||
      this.role.get(actor) !== 'manager' ||
      this.status.get(actor) !== 'accepted'
    )
      return Promise.resolve({ outcome: 'forbidden' });
    if (!target || this.status.get(target) !== 'accepted')
      return Promise.resolve({ outcome: 'invalid_target' });
    c.activeMembers.add(target);
    return Promise.resolve({ outcome: 'added' });
  }
  removeGroupMember(actor: string, conversationId: string, memberId: string) {
    const c = this.conversations.find(
      (x) => x.id === conversationId && x.type === 'group',
    );
    const target = this.memberIdUser(memberId);
    if (
      !c ||
      this.role.get(actor) !== 'manager' ||
      this.status.get(actor) !== 'accepted'
    )
      return Promise.resolve({ outcome: 'forbidden' });
    if (!target || !c.activeMembers.has(target))
      return Promise.resolve({ outcome: 'not_found' });
    c.activeMembers.delete(target);
    return Promise.resolve({ outcome: 'removed' });
  }
  sendMessage(
    userId: string,
    conversationId: string,
    dto: any,
    fingerprint: string,
  ) {
    const conversation = this.conversations.find(
      (c) => c.id === conversationId,
    );
    if (!conversation || !this.allowed(userId, conversation))
      return Promise.resolve({ outcome: 'forbidden' });
    const existing = this.messages.find(
      (m) =>
        m.conversationId === conversationId &&
        m.senderUserId === userId &&
        m.clientMessageId === dto.clientMessageId,
    );
    if (existing)
      return Promise.resolve(
        existing.requestFingerprint === fingerprint
          ? { outcome: 'reused', message: existing }
          : { outcome: 'conflict' },
      );
    const now = new Date();
    const message = {
      id: crypto.randomUUID(),
      conversationId,
      senderUserId: userId,
      clientMessageId: dto.clientMessageId,
      requestFingerprint: fingerprint,
      type: 'text',
      content: dto.content,
      createdAt: now,
      sender: {
        id: userId,
        fullName: userId === A ? 'A' : 'B',
        avatarUrl: null,
      },
    };
    this.messages.push(message);
    conversation.updatedAt = now;
    return Promise.resolve({ outcome: 'created', message });
  }
  resolveMessageRecipients(messageId: string) {
    const message = this.messages.find((m) => m.id === messageId);
    const c = this.conversations.find((x) => x.id === message?.conversationId);
    return Promise.resolve(
      !message || !c
        ? null
        : {
            message,
            recipientUserIds: [...c.activeMembers].filter(
              (id) => this.status.get(id) === 'accepted',
            ),
          },
    );
  }
  history(userId: string, conversationId: string, query: any) {
    const c = this.conversations.find((x) => x.id === conversationId);
    if (!c || !this.allowed(userId, c))
      return Promise.resolve({ outcome: 'forbidden' });
    return Promise.resolve({
      outcome: 'listed',
      messages: this.messages
        .filter((m) => m.conversationId === conversationId)
        .reverse()
        .slice(0, query.limit + 1),
    });
  }
  markRead(userId: string, conversationId: string, messageId: string) {
    const c = this.conversations.find((x) => x.id === conversationId);
    const m = this.messages.find(
      (x) => x.id === messageId && x.conversationId === conversationId,
    );
    if (!c || !this.allowed(userId, c))
      return Promise.resolve({ outcome: 'forbidden' });
    if (!m) return Promise.resolve({ outcome: 'not_found' });
    return Promise.resolve({
      outcome: 'updated',
      access: { lastReadMessageId: messageId, lastReadAt: new Date() },
    });
  }
  unreadCount(userId: string, conversationId: string) {
    const c = this.conversations.find((x) => x.id === conversationId);
    return Promise.resolve(
      !c || !this.allowed(userId, c)
        ? null
        : this.messages.filter(
            (m) =>
              m.conversationId === conversationId && m.senderUserId !== userId,
          ).length,
    );
  }
}

describe('Phase 12 Chat/Messaging (e2e)', () => {
  let app: INestApplication<App>;
  let repository: InMemoryChatRepository;
  const notifications = { processMessage: jest.fn().mockResolvedValue([]) };
  const realtime = { emitToUser: jest.fn() };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    repository = new InMemoryChatRepository();
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
      .overrideProvider(ChatRepository)
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

  it('A/B: creates one direct conversation and one idempotent message', async () => {
    const direct = await request(app.getHttpServer())
      .post(`/api/v1/families/${FAMILY}/conversations/direct`)
      .set(auth('a'))
      .send({ targetMemberId: MEMBER_B })
      .expect(200);
    const id = direct.body.data.conversation.id;
    const repeated = await request(app.getHttpServer())
      .post(`/api/v1/families/${FAMILY}/conversations/direct`)
      .set(auth('a'))
      .send({ targetMemberId: MEMBER_B })
      .expect(200);
    expect(repeated.body.data.conversation.id).toBe(id);
    const clientMessageId = crypto.randomUUID();
    const first = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${id}/messages`)
      .set(auth('a'))
      .send({ clientMessageId, content: 'Hello' })
      .expect(201);
    const retry = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${id}/messages`)
      .set(auth('a'))
      .send({ clientMessageId, content: 'Hello' })
      .expect(201);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(repository.messages).toHaveLength(1);
    expect(notifications.processMessage).toHaveBeenCalledTimes(1);
  });

  it('C: current recipients receive private user-room realtime only', () => {
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      A,
      'message.created',
      expect.any(Object),
    );
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      B,
      'message.created',
      expect.any(Object),
    );
    expect(realtime.emitToUser).not.toHaveBeenCalledWith(
      C,
      'message.created',
      expect.any(Object),
    );
  });

  it('keeps member arrays at the standard response envelope root', async () => {
    const id = repository.conversations[0].id;
    const response = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${id}/members`)
      .set(auth('a'))
      .expect(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data).not.toHaveProperty('data');
  });

  it('D: removed members immediately lose send/history/detail access', async () => {
    const id = repository.conversations[0].id;
    repository.status.set(B, 'removed');
    await request(app.getHttpServer())
      .get(`/api/v1/conversations/${id}/messages`)
      .set(auth('b'))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${id}/messages`)
      .set(auth('b'))
      .send({ clientMessageId: crypto.randomUUID(), content: 'stale' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/conversations/${id}`)
      .set(auth('b'))
      .expect(404);
    repository.status.set(B, 'accepted');
  });

  it('E: unrelated user cannot read, send or advance a read cursor', async () => {
    const id = repository.conversations[0].id;
    const messageId = repository.messages[0].id;
    await request(app.getHttpServer())
      .get(`/api/v1/conversations/${id}`)
      .set(auth('c'))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${id}/messages`)
      .set(auth('c'))
      .send({ clientMessageId: crypto.randomUUID(), content: 'probe' })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/conversations/${id}/read`)
      .set(auth('c'))
      .send({ lastReadMessageId: messageId })
      .expect(404);
  });

  it('F: manager creates a group and removed group member loses access', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/families/${FAMILY}/conversations/group`)
      .set(auth('a'))
      .send({ title: 'Family', memberIds: [MEMBER_B] })
      .expect(201);
    const id = response.body.data.id;
    await request(app.getHttpServer())
      .delete(`/api/v1/conversations/${id}/members/${MEMBER_B}`)
      .set(auth('a'))
      .expect(204);
    await request(app.getHttpServer())
      .get(`/api/v1/conversations/${id}`)
      .set(auth('b'))
      .expect(404);
  });

  it('G: strict validation rejects sender, timestamp, media and recipient spoofing', async () => {
    const id = repository.conversations[0].id;
    for (const extra of [
      { senderId: B },
      { createdAt: new Date().toISOString() },
      { mediaUrl: 'https://secret' },
      { recipientIds: [C] },
    ]) {
      await request(app.getHttpServer())
        .post(`/api/v1/conversations/${id}/messages`)
        .set(auth('a'))
        .send({
          clientMessageId: crypto.randomUUID(),
          content: 'safe',
          ...extra,
        })
        .expect(400);
    }
  });

  afterAll(async () => app.close());
});
