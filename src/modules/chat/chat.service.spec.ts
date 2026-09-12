import { ErrorCode } from '../../common/constants/error-codes';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { ChatRepository } from './chat.repository';
import { ChatService } from './chat.service';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const FAMILY = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const MESSAGE = '55555555-5555-4555-8555-555555555555';
const CLIENT = '66666666-6666-4666-8666-666666666666';
const now = new Date('2030-01-01T00:00:00Z');
const message = {
  id: MESSAGE,
  conversationId: CONVERSATION,
  senderUserId: USER,
  type: 'text',
  content: 'Help is on the way',
  createdAt: now,
  sender: { id: USER, fullName: 'User', avatarUrl: null },
};

describe('ChatService', () => {
  const setup = () => {
    const repository = {
      getOrCreateDirect: jest.fn().mockResolvedValue({
        outcome: 'created',
        conversationId: CONVERSATION,
      }),
      createGroup: jest.fn().mockResolvedValue({
        outcome: 'created',
        conversationId: CONVERSATION,
      }),
      listVisible: jest.fn().mockResolvedValue([]),
      detail: jest.fn().mockResolvedValue({
        access: {
          conversation: {
            id: CONVERSATION,
            familyId: FAMILY,
            type: 'direct',
            title: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        members: [],
        unreadCount: 0,
      }),
      listMembers: jest.fn().mockResolvedValue([]),
      addGroupMember: jest.fn().mockResolvedValue({ outcome: 'added' }),
      removeGroupMember: jest.fn().mockResolvedValue({ outcome: 'removed' }),
      sendMessage: jest.fn().mockResolvedValue({ outcome: 'created', message }),
      resolveMessageRecipients: jest
        .fn()
        .mockResolvedValue({ message, recipientUserIds: [USER, OTHER] }),
      history: jest.fn().mockResolvedValue({ outcome: 'listed', messages: [] }),
      markRead: jest.fn().mockResolvedValue({
        outcome: 'updated',
        access: { lastReadMessageId: MESSAGE, lastReadAt: now },
      }),
      unreadCount: jest.fn().mockResolvedValue(2),
    };
    const notifications = { processMessage: jest.fn().mockResolvedValue([]) };
    const realtime = { emitToUser: jest.fn() };
    return {
      repository,
      notifications,
      realtime,
      service: new ChatService(
        repository as unknown as ChatRepository,
        notifications as unknown as NotificationsService,
        realtime as unknown as RealtimeGateway,
      ),
    };
  };

  it('gets or creates a direct conversation from authenticated actor scope', async () => {
    const { repository, service } = setup();
    await service.createDirect(USER, FAMILY, OTHER);
    expect(repository.getOrCreateDirect).toHaveBeenCalledWith(
      USER,
      FAMILY,
      OTHER,
    );
  });

  it('returns the same logical direct conversation when it already exists', async () => {
    const { repository, service } = setup();
    repository.getOrCreateDirect.mockResolvedValue({
      outcome: 'existing',
      conversationId: CONVERSATION,
    });
    await expect(
      service.createDirect(USER, FAMILY, OTHER),
    ).resolves.toMatchObject({ created: false });
  });

  it.each(['forbidden', 'self'] as const)(
    'rejects invalid direct creation: %s',
    async (outcome) => {
      const { repository, service } = setup();
      repository.getOrCreateDirect.mockResolvedValue({ outcome });
      await expect(
        service.createDirect(USER, FAMILY, OTHER),
      ).rejects.toBeDefined();
    },
  );

  it('requires current manager-controlled group creation targets', async () => {
    const { repository, service } = setup();
    repository.createGroup.mockResolvedValue({ outcome: 'invalid_target' });
    await expect(
      service.createGroup(USER, FAMILY, { title: 'Group', memberIds: [OTHER] }),
    ).rejects.toMatchObject({ code: ErrorCode.CONVERSATION_INVALID_STATE });
  });

  it('persists before private realtime and Notification orchestration', async () => {
    const { repository, realtime, notifications, service } = setup();
    await service.send(USER, CONVERSATION, {
      clientMessageId: CLIENT,
      content: 'Help is on the way',
    });
    expect(repository.sendMessage).toHaveBeenCalledWith(
      USER,
      CONVERSATION,
      expect.any(Object),
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
    expect(realtime.emitToUser).toHaveBeenCalledTimes(2);
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      OTHER,
      'message.created',
      expect.objectContaining({ id: MESSAGE }),
    );
    expect(notifications.processMessage).toHaveBeenCalledWith(MESSAGE);
  });

  it('does not redeliver an idempotently reused message', async () => {
    const { repository, realtime, notifications, service } = setup();
    repository.sendMessage.mockResolvedValue({ outcome: 'reused', message });
    await expect(
      service.send(USER, CONVERSATION, {
        clientMessageId: CLIENT,
        content: message.content,
      }),
    ).resolves.toMatchObject({ id: MESSAGE, created: false });
    expect(realtime.emitToUser).not.toHaveBeenCalled();
    expect(notifications.processMessage).not.toHaveBeenCalled();
  });

  it('rejects conflicting reuse of a client message id', async () => {
    const { repository, service } = setup();
    repository.sendMessage.mockResolvedValue({ outcome: 'conflict' });
    await expect(
      service.send(USER, CONVERSATION, {
        clientMessageId: CLIENT,
        content: 'different',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.MESSAGE_IDEMPOTENCY_CONFLICT });
  });

  it('keeps the committed message when Socket and Notification transports fail', async () => {
    const { realtime, notifications, service } = setup();
    realtime.emitToUser.mockImplementation(() => {
      throw new Error('socket');
    });
    notifications.processMessage.mockRejectedValue(new Error('fcm path'));
    await expect(
      service.send(USER, CONVERSATION, {
        clientMessageId: CLIENT,
        content: message.content,
      }),
    ).resolves.toMatchObject({ id: MESSAGE });
  });

  it('does not deliver when message persistence rejects access', async () => {
    const { repository, realtime, notifications, service } = setup();
    repository.sendMessage.mockResolvedValue({ outcome: 'forbidden' });
    await expect(
      service.send(USER, CONVERSATION, {
        clientMessageId: CLIENT,
        content: message.content,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONVERSATION_NOT_FOUND });
    expect(realtime.emitToUser).not.toHaveBeenCalled();
    expect(notifications.processMessage).not.toHaveBeenCalled();
  });

  it('uses a bounded opaque history cursor', async () => {
    const { repository, service } = setup();
    repository.history.mockResolvedValue({
      outcome: 'listed',
      messages: [message, { ...message, id: CLIENT }],
    });
    const result = await service.history(USER, CONVERSATION, { limit: 1 });
    expect(result.pagination).toMatchObject({ hasMore: true, limit: 1 });
    expect(result.pagination.nextCursor).toEqual(expect.any(String));
  });

  it('returns not found for stale/foreign history membership', async () => {
    const { repository, service } = setup();
    repository.history.mockResolvedValue({ outcome: 'forbidden' });
    await expect(
      service.history(USER, CONVERSATION, { limit: 30 }),
    ).rejects.toMatchObject({ code: ErrorCode.CONVERSATION_NOT_FOUND });
  });

  it('advances a per-user conversation cursor and exposes no per-message receipt', async () => {
    const { service } = setup();
    await expect(
      service.markRead(USER, CONVERSATION, MESSAGE),
    ).resolves.toEqual({
      conversationId: CONVERSATION,
      lastReadMessageId: MESSAGE,
      lastReadAt: now,
      updated: true,
    });
  });

  it('treats an older read cursor as an idempotent no-op', async () => {
    const { repository, service } = setup();
    repository.markRead.mockResolvedValue({
      outcome: 'unchanged',
      access: { lastReadMessageId: MESSAGE, lastReadAt: now },
    });
    await expect(
      service.markRead(USER, CONVERSATION, MESSAGE),
    ).resolves.toMatchObject({ updated: false });
  });

  it('protects group membership management by current authorization', async () => {
    const { repository, service } = setup();
    repository.addGroupMember.mockResolvedValue({ outcome: 'forbidden' });
    await expect(
      service.addMember(USER, CONVERSATION, OTHER),
    ).rejects.toMatchObject({ code: ErrorCode.CONVERSATION_NOT_FOUND });
  });

  it('returns an owner-scoped unread count', async () => {
    const { service } = setup();
    await expect(service.unreadCount(USER, CONVERSATION)).resolves.toEqual({
      count: 2,
    });
  });
});
