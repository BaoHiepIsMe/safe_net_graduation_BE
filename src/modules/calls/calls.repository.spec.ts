import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CallsRepository } from './calls.repository';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const FAMILY = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const CALL = '55555555-5555-4555-8555-555555555555';
const REQUEST = '66666666-6666-4666-8666-666666666666';

const baseCall = (overrides: Record<string, unknown> = {}) => ({
  id: CALL,
  familyId: FAMILY,
  conversationId: CONVERSATION,
  callerUserId: A,
  calleeUserId: B,
  clientRequestId: REQUEST,
  requestFingerprint: 'a'.repeat(64),
  callType: 'voice',
  status: 'ringing',
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 45_000),
  acceptedAt: null,
  terminalAt: null,
  updatedAt: new Date(),
  caller: { id: A, fullName: 'A', avatarUrl: null },
  callee: { id: B, fullName: 'B', avatarUrl: null },
  ...overrides,
});

function serialPrisma(tx: any) {
  let tail = Promise.resolve();
  return {
    $transaction: jest.fn((work: (client: any) => unknown) => {
      const result = tail.then(() => work(tx));
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }),
  } as unknown as PrismaService;
}

describe('CallsRepository concurrency and authorization', () => {
  it('concurrent identical creation returns one created and one reused Call', async () => {
    let stored: any = null;
    const tx: any = {
      $queryRaw: jest.fn(),
      callLog: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(stored)),
        create: jest.fn().mockImplementation(({ data }: any) => {
          stored = baseCall({
            requestFingerprint: data.requestFingerprint,
            clientRequestId: data.clientRequestId,
          });
          return Promise.resolve(stored);
        }),
      },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: CONVERSATION,
          familyId: FAMILY,
          type: 'direct',
          members: [A, B].map((userId) => ({
            userId,
            profile: {
              family_members_family_members_user_idToprofiles: [
                { familyId: FAMILY },
              ],
            },
          })),
        }),
      },
    };
    const repository = new CallsRepository(serialPrisma(tx));
    const input = { clientRequestId: REQUEST, callType: 'voice' as const };
    const [one, two] = await Promise.all([
      repository.create(
        A,
        CONVERSATION,
        input,
        'a'.repeat(64),
        new Date(Date.now() + 45_000),
      ),
      repository.create(
        A,
        CONVERSATION,
        input,
        'a'.repeat(64),
        new Date(Date.now() + 45_000),
      ),
    ]);
    expect([one.outcome, two.outcome].sort()).toEqual(['created', 'reused']);
    expect(tx.callLog.create).toHaveBeenCalledTimes(1);
  });

  it('serializes accept versus cancel so exactly one legal transition wins', async () => {
    let state: any = baseCall();
    const tx: any = {
      $queryRaw: jest.fn(),
      callLog: {
        findFirst: jest
          .fn()
          .mockImplementation(() => Promise.resolve({ ...state })),
        update: jest.fn().mockImplementation(({ data }: any) => {
          state = { ...state, ...data };
          return Promise.resolve({ ...state });
        }),
      },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: CONVERSATION }),
      },
    };
    const repository = new CallsRepository(serialPrisma(tx));
    const [accept, cancel] = await Promise.all([
      repository.transition(B, CALL, 'accept', new Date()),
      repository.transition(A, CALL, 'cancel', new Date()),
    ]);
    expect(
      [accept.outcome, cancel.outcome].filter((x) => x === 'updated'),
    ).toHaveLength(1);
    expect(state.status).toBe('accepted');
    expect(tx.callLog.update).toHaveBeenCalledTimes(1);
  });

  it('serializes timeout versus accept so accepted and missed cannot both win', async () => {
    let state: any = baseCall({
      expiresAt: new Date('2030-01-01T00:00:45.000Z'),
    });
    const tx: any = {
      $queryRaw: jest.fn(),
      callLog: {
        findFirst: jest
          .fn()
          .mockImplementation(() => Promise.resolve({ ...state })),
        update: jest.fn().mockImplementation(({ data }: any) => {
          state = { ...state, ...data };
          return Promise.resolve({ ...state });
        }),
        updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
          if (
            state.status !== where.status ||
            state.expiresAt > where.expiresAt.lte
          ) {
            return Promise.resolve({ count: 0 });
          }
          state = { ...state, ...data };
          return Promise.resolve({ count: 1 });
        }),
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve({ ...state })),
      },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: CONVERSATION }),
      },
    };
    const prisma: any = serialPrisma(tx);
    prisma.callLog = {
      findMany: jest.fn().mockResolvedValue([{ id: CALL }]),
    };
    const repository = new CallsRepository(prisma as PrismaService);
    const acceptAt = new Date('2030-01-01T00:00:44.999Z');
    const sweepAt = new Date('2030-01-01T00:00:45.000Z');
    const [accepted, missed] = await Promise.all([
      repository.transition(B, CALL, 'accept', acceptAt),
      repository.expireDue(sweepAt, 50),
    ]);
    expect(accepted.outcome).toBe('updated');
    expect(missed).toEqual([]);
    expect(state.status).toBe('accepted');
    expect(state.acceptedAt).toEqual(acceptAt);
    expect(state.terminalAt).toBeNull();
  });

  it('requires current family/conversation eligibility for new signaling', async () => {
    const prisma: any = {
      callLog: {
        findFirst: jest
          .fn()
          .mockResolvedValue(baseCall({ status: 'accepted' })),
      },
      conversation: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const repository = new CallsRepository(prisma as PrismaService);
    await expect(
      repository.authorizeSignal(B, CALL, 'answer'),
    ).resolves.toBeNull();
  });

  it('keeps history authorization bound to durable caller/callee provenance', async () => {
    const prisma: any = {
      callLog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const repository = new CallsRepository(prisma as PrismaService);
    await repository.listOwned(A, { limit: 30 });
    expect(prisma.callLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ callerUserId: A }, { calleeUserId: A }],
        }),
      }),
    );
  });
});
