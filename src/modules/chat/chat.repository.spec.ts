import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ChatRepository } from './chat.repository';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const FAMILY = '33333333-3333-4333-8333-333333333333';
const MEMBER = '44444444-4444-4444-8444-444444444444';
const CONVERSATION = '55555555-5555-4555-8555-555555555555';
const CLIENT = '66666666-6666-4666-8666-666666666666';

describe('ChatRepository authorization and concurrency controls', () => {
  it('serializes canonical direct get-or-create under an advisory lock', async () => {
    const tx: any = {
      familyMember: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'actor', userId: A })
          .mockResolvedValueOnce({ id: MEMBER, userId: B }),
      },
      $queryRaw: jest.fn(),
      conversation: {
        findUnique: jest.fn().mockResolvedValue({ id: CONVERSATION }),
        create: jest.fn(),
      },
    };
    const prisma: any = {
      $transaction: jest.fn((work: (client: any) => unknown) => work(tx)),
    };
    const repository = new ChatRepository(prisma as PrismaService);
    await expect(
      repository.getOrCreateDirect(A, FAMILY, MEMBER),
    ).resolves.toEqual({
      outcome: 'existing',
      conversationId: CONVERSATION,
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.conversation.findUnique).toHaveBeenCalledWith({
      where: {
        familyId_directKey: { familyId: FAMILY, directKey: `${A}:${B}` },
      },
      select: { id: true },
    });
    expect(prisma.$transaction.mock.calls[0][1]).toMatchObject({
      isolationLevel: 'Serializable',
    });
  });

  it('rechecks current accepted active-family access on history reads', async () => {
    const prisma: any = {
      conversationMember: { findFirst: jest.fn().mockResolvedValue(null) },
      message: { findMany: jest.fn() },
    };
    const repository = new ChatRepository(prisma as PrismaService);
    await expect(
      repository.history(A, CONVERSATION, { limit: 30 }),
    ).resolves.toEqual({ outcome: 'forbidden' });
    expect(prisma.conversationMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: CONVERSATION,
          userId: A,
          isActive: true,
          conversation: {
            family: {
              status: 'active',
              members: { some: { userId: A, status: 'accepted' } },
            },
          },
        }),
      }),
    );
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it('uses one set-based unread query for a conversation page', async () => {
    const prisma: any = {
      conversationMember: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn(),
    };
    const repository = new ChatRepository(prisma as PrismaService);
    await expect(repository.listVisible(A, { limit: 30 })).resolves.toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.conversationMember.findMany).toHaveBeenCalledTimes(1);
  });

  it('resolves message recipients only from active conversation/current family memberships', async () => {
    const prisma: any = {
      message: {
        findUnique: jest.fn().mockResolvedValue({
          id: CLIENT,
          conversationId: CONVERSATION,
          senderUserId: A,
          type: 'text',
          content: 'safe',
          createdAt: new Date(),
          sender: { id: A, fullName: 'A', avatarUrl: null },
          conversation: { familyId: FAMILY },
        }),
      },
      conversationMember: {
        findMany: jest.fn().mockResolvedValue([{ userId: B }]),
      },
    };
    const repository = new ChatRepository(prisma as PrismaService);
    await expect(
      repository.resolveMessageRecipients(CLIENT),
    ).resolves.toMatchObject({ recipientUserIds: [B] });
    expect(prisma.conversationMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: CONVERSATION,
          isActive: true,
        }),
      }),
    );
  });
});
