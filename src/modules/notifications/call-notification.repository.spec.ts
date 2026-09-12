import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationsRepository } from './notifications.repository';

const CALL = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '22222222-2222-4222-8222-222222222222';
const FAMILY = '33333333-3333-4333-8333-333333333333';
const CALLER = '44444444-4444-4444-8444-444444444444';
const CALLEE = '55555555-5555-4555-8555-555555555555';
const NOTIFICATION = '66666666-6666-4666-8666-666666666666';

describe('NotificationsRepository incoming Call integration', () => {
  const setup = (
    options: { authorized?: boolean; existing?: boolean; status?: string } = {},
  ) => {
    const tx: any = {
      $queryRaw: jest.fn(),
      callLog: {
        findFirst: jest.fn().mockResolvedValue(
          options.status === 'ended'
            ? null
            : {
                id: CALL,
                familyId: FAMILY,
                conversationId: CONVERSATION,
                callerUserId: CALLER,
                calleeUserId: CALLEE,
                callType: 'video',
                createdAt: new Date(),
                caller: { fullName: 'Caller' },
                callee: {
                  UserSetting: { pushNotificationsEnabled: true },
                  Device: [
                    { id: crypto.randomUUID() },
                    { id: crypto.randomUUID() },
                  ],
                },
              },
        ),
      },
      conversation: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            options.authorized === false ? null : { id: CONVERSATION },
          ),
      },
      notification: {
        findUnique: jest
          .fn()
          .mockResolvedValue(options.existing ? { id: NOTIFICATION } : null),
        create: jest.fn().mockResolvedValue({ id: NOTIFICATION }),
      },
      notificationDelivery: { createMany: jest.fn() },
    };
    const repository = new NotificationsRepository({
      $transaction: (work: (client: any) => unknown) => work(tx),
    } as unknown as PrismaService);
    return { repository, tx };
  };

  it('creates one callee Notification with per-Device deliveries', async () => {
    const { repository, tx } = setup();
    await expect(repository.createFromCall(CALL)).resolves.toHaveLength(1);
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipient_user_id: CALLEE,
          sender_user_id: CALLER,
          notification_type: 'call_incoming',
          related_table: 'call_log',
          related_id: CALL,
        }),
      }),
    );
    expect(
      tx.notificationDelivery.createMany.mock.calls[0][0].data,
    ).toHaveLength(2);
  });

  it('does not duplicate an incoming Notification on replay', async () => {
    const { repository, tx } = setup({ existing: true });
    await expect(repository.createFromCall(CALL)).resolves.toEqual([]);
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('revalidates current participant authorization after Call commit', async () => {
    const { repository, tx } = setup({ authorized: false });
    await expect(repository.createFromCall(CALL)).resolves.toEqual([]);
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('does not create a late incoming Notification for a terminal Call', async () => {
    const { repository, tx } = setup({ status: 'ended' });
    await expect(repository.createFromCall(CALL)).resolves.toEqual([]);
    expect(tx.conversation.findFirst).not.toHaveBeenCalled();
  });

  it('keeps lock-screen content generic and excludes signaling data', async () => {
    const { repository, tx } = setup();
    await repository.createFromCall(CALL);
    const data = tx.notification.create.mock.calls[0][0].data;
    expect(data.message).toBe('Caller is calling');
    expect(JSON.stringify(data)).not.toMatch(
      /sdp|candidate|token|installation/i,
    );
  });
});
