import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationsRepository } from './notifications.repository';

const MESSAGE = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '22222222-2222-4222-8222-222222222222';
const FAMILY = '33333333-3333-4333-8333-333333333333';
const SENDER = '44444444-4444-4444-8444-444444444444';
const RECIPIENT = '55555555-5555-4555-8555-555555555555';
const NOTIFICATION = '66666666-6666-4666-8666-666666666666';

describe('NotificationsRepository message integration', () => {
  const setup = (
    overrides: {
      senderCurrent?: boolean;
      existing?: boolean;
      recipients?: any[];
    } = {},
  ) => {
    const tx: any = {
      $queryRaw: jest.fn(),
      message: {
        findFirst: jest.fn().mockResolvedValue({
          id: MESSAGE,
          conversationId: CONVERSATION,
          senderUserId: SENDER,
          createdAt: new Date('2030-01-01T00:00:00Z'),
          sender: { fullName: 'Sender' },
          conversation: { familyId: FAMILY, family: { status: 'active' } },
        }),
      },
      conversationMember: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            overrides.senderCurrent === false ? null : { id: 'current' },
          ),
        findMany: jest.fn().mockResolvedValue(
          overrides.recipients ?? [
            {
              userId: RECIPIENT,
              profile: {
                UserSetting: { pushNotificationsEnabled: true },
                Device: [
                  { id: crypto.randomUUID() },
                  { id: crypto.randomUUID() },
                ],
              },
            },
          ],
        ),
      },
      notification: {
        findUnique: jest
          .fn()
          .mockResolvedValue(overrides.existing ? { id: NOTIFICATION } : null),
        create: jest.fn().mockResolvedValue({
          id: NOTIFICATION,
          family_id: FAMILY,
          notification_type: 'message',
          title: 'New message',
          message: 'New message from Sender',
          metadata: { conversationId: CONVERSATION, messageId: MESSAGE },
          is_read: false,
          read_at: null,
          created_at: new Date(),
        }),
      },
      notificationDelivery: { createMany: jest.fn() },
    };
    const repository = new NotificationsRepository({
      $transaction: (work: (client: any) => unknown) => work(tx),
    } as unknown as PrismaService);
    return { repository, tx };
  };

  it('creates one logical notification and multiple device deliveries', async () => {
    const { repository, tx } = setup();
    await expect(repository.createFromMessage(MESSAGE)).resolves.toHaveLength(
      1,
    );
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipient_user_id: RECIPIENT,
          sender_user_id: SENDER,
          related_table: 'message',
          related_id: MESSAGE,
          notification_type: 'message',
        }),
      }),
    );
    expect(
      tx.notificationDelivery.createMany.mock.calls[0][0].data,
    ).toHaveLength(2);
  });

  it('does not duplicate notification state when the same message is processed again', async () => {
    const { repository, tx } = setup({ existing: true });
    await expect(repository.createFromMessage(MESSAGE)).resolves.toEqual([]);
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('suppresses notification processing when sender authorization is stale', async () => {
    const { repository, tx } = setup({ senderCurrent: false });
    await expect(repository.createFromMessage(MESSAGE)).resolves.toEqual([]);
    expect(tx.conversationMember.findMany).not.toHaveBeenCalled();
  });

  it('does not fabricate notification recipients for an empty current recipient set', async () => {
    const { repository, tx } = setup({ recipients: [] });
    await expect(repository.createFromMessage(MESSAGE)).resolves.toEqual([]);
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('queries recipients with current active conversation and family authorization', async () => {
    const { repository, tx } = setup();
    await repository.createFromMessage(MESSAGE);
    expect(tx.conversationMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: CONVERSATION,
          isActive: true,
          userId: { not: SENDER },
        }),
      }),
    );
  });
});
