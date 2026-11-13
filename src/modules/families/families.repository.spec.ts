import { Prisma } from '../../generated/prisma/client';
import { FamiliesRepository } from './families.repository';
import { INVITE_CODE_ALPHABET } from './families.constants';
import { PrismaService } from '../../infrastructure/database/prisma.service';

describe('FamiliesRepository family creation transaction', () => {
  const dto = {
    familyName: 'Gia đình An',
    familyLabel: 'caregiver' as const,
  };

  it('creates the family and accepted manager in one transaction', async () => {
    const memberCreate = jest.fn().mockResolvedValue({
      id: 'member-1',
      role: 'manager',
      status: 'accepted',
    });
    const tx = {
      family: {
        create: jest.fn().mockResolvedValue({ id: 'family-1' }),
      },
      familyMember: { create: memberCreate },
    };
    const transaction = jest.fn((callback) => callback(tx));
    const prisma = {
      $transaction: transaction,
    } as unknown as PrismaService;

    const result = await new FamiliesRepository(prisma).createFamilyWithOwner(
      'user-1',
      dto,
    );
    expect(result.membership).toMatchObject({
      role: 'manager',
      status: 'accepted',
    });
    expect(memberCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          familyId: 'family-1',
          userId: 'user-1',
          role: 'manager',
          status: 'accepted',
        }),
      }),
    );
  });

  it('rejects the transaction when manager membership creation fails', async () => {
    const tx = {
      family: { create: jest.fn().mockResolvedValue({ id: 'family-1' }) },
      familyMember: {
        create: jest.fn().mockRejectedValue(new Error('member write failed')),
      },
    };
    const transaction = jest.fn((callback) => callback(tx));
    const prisma = {
      $transaction: transaction,
    } as unknown as PrismaService;

    await expect(
      new FamiliesRepository(prisma).createFamilyWithOwner('user-1', dto),
    ).rejects.toThrow('member write failed');
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

/** Runs the transaction callback against [tx] like Prisma would. */
function repoWithTx(tx: unknown, extra: Record<string, unknown> = {}) {
  const prisma = {
    $transaction: jest.fn((cb) => cb(tx)),
    ...extra,
  } as unknown as PrismaService;
  return new FamiliesRepository(prisma);
}

describe('FamiliesRepository invitation expiry', () => {
  const pending = (invitedAt: Date | null) => ({
    id: 'inv-1',
    userId: 'user-1',
    status: 'pending',
    invitedAt,
    familyId: 'family-1',
    family: { status: 'active' },
  });

  it('refuses to accept an invitation older than 7 days', async () => {
    const update = jest.fn();
    const tx = {
      familyMember: {
        findUnique: jest.fn().mockResolvedValue(pending(daysAgo(8))),
        update,
      },
    };
    await expect(
      repoWithTx(tx).transitionInvitation('inv-1', 'user-1', 'accepted'),
    ).resolves.toEqual({ outcome: 'expired' });
    expect(update).not.toHaveBeenCalled();
  });

  it('accepts an invitation that is still valid', async () => {
    const tx = {
      familyMember: {
        findUnique: jest.fn().mockResolvedValue(pending(daysAgo(6))),
        update: jest.fn().mockResolvedValue({ id: 'inv-1' }),
      },
    };
    await expect(
      repoWithTx(tx).transitionInvitation('inv-1', 'user-1', 'accepted'),
    ).resolves.toMatchObject({ outcome: 'updated' });
  });

  it('still lets the invitee reject an expired invitation', async () => {
    const tx = {
      familyMember: {
        findUnique: jest.fn().mockResolvedValue(pending(daysAgo(30))),
        update: jest.fn().mockResolvedValue({ id: 'inv-1' }),
      },
    };
    await expect(
      repoWithTx(tx).transitionInvitation('inv-1', 'user-1', 'rejected'),
    ).resolves.toMatchObject({ outcome: 'updated' });
  });

  it('hides expired invitations from the invitee list', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      familyMember: { findMany, count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    await new FamiliesRepository(prisma).listPendingInvitations('user-1', {
      page: 1,
      limit: 20,
    });
    const where = findMany.mock.calls[0][0].where;
    const cutoff: Date = where.invitedAt.gte;
    expect(Date.now() - cutoff.getTime()).toBeCloseTo(7 * DAY, -4);
  });

  it('cancel only affects pending invitations of the family', async () => {
    const update = jest.fn().mockResolvedValue({});
    const find = jest.fn();
    const repo = repoWithTx({ familyMember: { findFirst: find, update } });

    find.mockResolvedValueOnce(null);
    await expect(repo.cancelInvitation('f', 'i')).resolves.toEqual({
      outcome: 'not_found',
    });
    find.mockResolvedValueOnce({ id: 'i', status: 'accepted' });
    await expect(repo.cancelInvitation('f', 'i')).resolves.toEqual({
      outcome: 'invalid_state',
    });
    expect(update).not.toHaveBeenCalled();

    find.mockResolvedValueOnce({ id: 'i', status: 'pending' });
    await expect(repo.cancelInvitation('f', 'i')).resolves.toEqual({
      outcome: 'cancelled',
    });
    expect(update.mock.calls[0][0].data).toMatchObject({ status: 'removed' });
    expect(find.mock.calls[0][0].where).toEqual({ id: 'i', familyId: 'f' });
  });

  it('resend resets invitedAt and the sender', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'i' });
    const repo = repoWithTx({
      familyMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'i', status: 'pending' }),
        update,
      },
    });
    const before = Date.now();
    await expect(
      repo.resendInvitation('f', 'i', 'actor'),
    ).resolves.toMatchObject({ outcome: 'resent' });
    const data = update.mock.calls[0][0].data;
    expect(data.invitedByUserId).toBe('actor');
    expect(data.invitedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('FamiliesRepository invite codes', () => {
  const FUTURE = new Date(Date.now() + 3 * DAY);
  const PAST = new Date(Date.now() - DAY);

  function familyPrisma(initial: {
    inviteCode: string | null;
    inviteCodeExpiresAt: Date | null;
  }) {
    const state = { ...initial };
    const prisma = {
      family: {
        findUnique: jest.fn(() => Promise.resolve({ ...state })),
        updateMany: jest.fn(({ data }) => {
          Object.assign(state, data);
          return Promise.resolve({ count: 1 });
        }),
        update: jest.fn(({ data }) => {
          Object.assign(state, data);
          return Promise.resolve({ id: 'f' });
        }),
      },
    };
    return { prisma, repo: new FamiliesRepository(prisma as never), state };
  }

  it('returns a live code unchanged', async () => {
    const { repo, prisma } = familyPrisma({
      inviteCode: 'ABCD2345',
      inviteCodeExpiresAt: FUTURE,
    });
    await expect(repo.getOrCreateInviteCode('f')).resolves.toEqual({
      code: 'ABCD2345',
      expiresAt: FUTURE,
    });
    expect(prisma.family.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null, null],
    ['expired', 'ABCD2345', PAST],
    ['without expiry', 'ABCD2345', null],
  ])('creates a new code when it is %s', async (_n, inviteCode, exp) => {
    const { repo } = familyPrisma({ inviteCode, inviteCodeExpiresAt: exp });
    const created = await repo.getOrCreateInviteCode('f');
    expect(created.code).toMatch(new RegExp(`^[${INVITE_CODE_ALPHABET}]{8}$`));
    expect(created.code).not.toBe('ABCD2345');
    const days = (created.expiresAt.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('returns the winner when another request created the code first', async () => {
    const { repo, prisma } = familyPrisma({
      inviteCode: null,
      inviteCodeExpiresAt: null,
    });
    prisma.family.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.family.findUnique
      .mockResolvedValueOnce({ inviteCode: null, inviteCodeExpiresAt: null })
      .mockResolvedValueOnce({
        inviteCode: 'WINNER23',
        inviteCodeExpiresAt: FUTURE,
      });
    await expect(repo.getOrCreateInviteCode('f')).resolves.toEqual({
      code: 'WINNER23',
      expiresAt: FUTURE,
    });
  });

  it('regenerate always produces a different valid code', async () => {
    const { repo, state } = familyPrisma({
      inviteCode: 'ABCD2345',
      inviteCodeExpiresAt: FUTURE,
    });
    const seen = new Set<string>(['ABCD2345']);
    for (let i = 0; i < 20; i++) {
      const before = state.inviteCode;
      const { code } = await repo.regenerateInviteCode('f');
      expect(code).not.toBe(before);
      expect(code).toMatch(new RegExp(`^[${INVITE_CODE_ALPHABET}]{8}$`));
      seen.add(code);
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it('retries when the generated code collides (P2002)', async () => {
    const { repo, prisma } = familyPrisma({
      inviteCode: null,
      inviteCodeExpiresAt: null,
    });
    prisma.family.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(repo.regenerateInviteCode('f')).resolves.toHaveProperty(
      'code',
    );
    expect(prisma.family.update).toHaveBeenCalledTimes(2);
  });

  it('gives up after 5 collisions', async () => {
    const { repo, prisma } = familyPrisma({
      inviteCode: null,
      inviteCodeExpiresAt: null,
    });
    prisma.family.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(repo.regenerateInviteCode('f')).rejects.toThrow();
    expect(prisma.family.update).toHaveBeenCalledTimes(5);
  });
});

describe('FamiliesRepository joinByInviteCode', () => {
  const family = { id: 'family-1', ownerUserId: 'owner', status: 'active' };
  const dto = { code: 'ABCD2345', familyLabel: 'daughter' as const };

  function joinTx(existing: { id: string; status: string } | null) {
    const create = jest.fn().mockResolvedValue({ id: 'new' });
    const update = jest.fn().mockResolvedValue({ id: 'old' });
    const findFirst = jest.fn().mockResolvedValue(family);
    const tx = {
      family: { findFirst },
      familyMember: {
        findUnique: jest.fn().mockResolvedValue(existing),
        create,
        update,
      },
    };
    return { repo: repoWithTx(tx), create, update, findFirst };
  }

  it('looks the code up only among live codes of active families', async () => {
    const { repo, findFirst } = joinTx(null);
    await repo.joinByInviteCode('user-1', 'ABCD2345', dto);
    const where = findFirst.mock.calls[0][0].where;
    expect(where.inviteCode).toBe('ABCD2345');
    expect(where.status).toBe('active');
    expect(where.inviteCodeExpiresAt.gt).toBeInstanceOf(Date);
  });

  it('reports an unknown, expired or replaced code', async () => {
    const { repo, findFirst, create } = joinTx(null);
    findFirst.mockResolvedValue(null);
    await expect(
      repo.joinByInviteCode('user-1', 'NOPE2345', dto),
    ).resolves.toEqual({ outcome: 'invalid_code' });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates an accepted member with the derived role', async () => {
    const { repo, create } = joinTx(null);
    await expect(
      repo.joinByInviteCode('user-1', 'ABCD2345', dto),
    ).resolves.toMatchObject({ outcome: 'joined' });
    expect(create.mock.calls[0][0].data).toMatchObject({
      familyId: 'family-1',
      userId: 'user-1',
      role: 'child',
      status: 'accepted',
      invitedByUserId: null,
      removedAt: null,
    });
  });

  it('refuses an existing accepted member', async () => {
    const { repo, create, update } = joinTx({ id: 'm', status: 'accepted' });
    await expect(
      repo.joinByInviteCode('user-1', 'ABCD2345', dto),
    ).resolves.toEqual({ outcome: 'already_member' });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['pending', 'rejected', 'removed'])(
    'turns an existing %s row into an accepted member',
    async (status) => {
      const { repo, create, update } = joinTx({ id: 'm', status });
      await expect(
        repo.joinByInviteCode('user-1', 'ABCD2345', dto),
      ).resolves.toMatchObject({ outcome: 'joined' });
      expect(create).not.toHaveBeenCalled();
      expect(update.mock.calls[0][0]).toMatchObject({
        where: { id: 'm' },
        data: { status: 'accepted', role: 'child', removedAt: null },
      });
    },
  );
});

describe('FamiliesRepository transferOwnership', () => {
  function transferTx(opts: {
    owner?: string;
    target?: {
      id: string;
      userId: string;
      role: string;
      status: string;
    } | null;
  }) {
    const memberUpdate = jest.fn().mockResolvedValue({});
    const familyUpdate = jest.fn().mockResolvedValue({ id: 'f' });
    const tx = {
      family: {
        findUnique: jest.fn().mockResolvedValue({
          ownerUserId: opts.owner ?? 'owner',
          status: 'active',
        }),
        update: familyUpdate,
      },
      familyMember: {
        findFirst: jest.fn().mockResolvedValue(opts.target ?? null),
        update: memberUpdate,
      },
    };
    return { repo: repoWithTx(tx), memberUpdate, familyUpdate };
  }
  const target = (role: string, status = 'accepted', userId = 'target') => ({
    id: 'tm',
    userId,
    role,
    status,
  });

  it.each(['adult', 'manager'])(
    'hands over to an accepted %s',
    async (role) => {
      const { repo, memberUpdate, familyUpdate } = transferTx({
        target: target(role),
      });
      await expect(
        repo.transferOwnership('f', 'owner', 'tm'),
      ).resolves.toMatchObject({ outcome: 'transferred' });
      expect(memberUpdate.mock.calls[0][0].data.role).toBe('manager');
      expect(familyUpdate.mock.calls[0][0].data.ownerUserId).toBe('target');
    },
  );

  it.each([
    ['child', target('child')],
    ['elder', target('elder')],
    ['self', target('manager', 'accepted', 'owner')],
    ['not accepted', target('adult', 'pending')],
    ['unknown member', null],
  ])('rejects %s target without changes', async (_n, t) => {
    const { repo, memberUpdate, familyUpdate } = transferTx({ target: t });
    await expect(repo.transferOwnership('f', 'owner', 'tm')).resolves.toEqual({
      outcome: 'invalid_target',
    });
    expect(memberUpdate).not.toHaveBeenCalled();
    expect(familyUpdate).not.toHaveBeenCalled();
  });

  it('refuses when the caller is no longer the owner', async () => {
    const { repo, familyUpdate } = transferTx({
      owner: 'someone-else',
      target: target('adult'),
    });
    await expect(repo.transferOwnership('f', 'owner', 'tm')).resolves.toEqual({
      outcome: 'not_owner',
    });
    expect(familyUpdate).not.toHaveBeenCalled();
  });
});
