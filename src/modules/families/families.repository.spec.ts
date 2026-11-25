import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { INVITE_CODE_ALPHABET } from './families.constants';
import { FamiliesRepository } from './families.repository';

const ADULT_DOB = new Date('1990-01-15T00:00:00.000Z');
const SENIOR_DOB = new Date('1958-05-10T00:00:00.000Z');
const MINOR_DOB = new Date('2014-06-01T00:00:00.000Z');

describe('FamiliesRepository family creation transaction', () => {
  const dto = {
    familyName: 'Gia đình An',
    familyLabel: 'caregiver' as const,
  };

  it('creates the family and accepted care manager in one transaction for adult >= 18', async () => {
    const memberCreate = jest.fn().mockResolvedValue({
      id: 'member-1',
      canManageCare: true,
      isHired: true,
      status: 'accepted',
    });
    const tx = {
      profile: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', dateOfBirth: ADULT_DOB }),
      },
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
    expect(result).toMatchObject({
      outcome: 'created',
      membership: {
        canManageCare: true,
        isHired: true,
        status: 'accepted',
      },
    });
    expect(memberCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          familyId: 'family-1',
          userId: 'user-1',
          canManageCare: true,
          careGrantedBy: 'user-1',
          isCareRecipient: false,
          isHired: true,
          status: 'accepted',
        }),
      }),
    );
  });

  it('rejects family creation when profile has no dateOfBirth or is a minor (< 18)', async () => {
    const txMissingDob = {
      profile: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', dateOfBirth: null }),
      },
    };
    const repoMissingDob = new FamiliesRepository({
      $transaction: jest.fn((cb) => cb(txMissingDob)),
    } as unknown as PrismaService);
    await expect(
      repoMissingDob.createFamilyWithOwner('user-1', dto),
    ).resolves.toEqual({ outcome: 'dob_required' });

    const txMinor = {
      profile: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', dateOfBirth: MINOR_DOB }),
      },
    };
    const repoMinor = new FamiliesRepository({
      $transaction: jest.fn((cb) => cb(txMinor)),
    } as unknown as PrismaService);
    await expect(
      repoMinor.createFamilyWithOwner('user-1', dto),
    ).resolves.toEqual({ outcome: 'minor_forbidden' });
  });

  it('rejects the transaction when manager membership creation fails', async () => {
    const tx = {
      profile: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', dateOfBirth: ADULT_DOB }),
      },
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

describe('FamiliesRepository invitation expiry and age flag resolution', () => {
  const pending = (
    invitedAt: Date | null,
    overrides: Record<string, unknown> = {},
  ) => ({
    id: 'inv-1',
    userId: 'user-1',
    status: 'pending',
    invitedAt,
    invitedByUserId: 'inviter-1',
    familyId: 'family-1',
    familyLabel: 'other',
    canManageCare: false,
    careGrantedBy: null,
    isCareRecipient: false,
    careRecipientSetBy: null,
    isHired: false,
    profile: { dateOfBirth: ADULT_DOB },
    family: { status: 'active' },
    ...overrides,
  });

  it('refuses to accept an invitation older than 7 days', async () => {
    const update = jest.fn();
    const tx = {
      familyMember: {
        findUnique: jest.fn().mockResolvedValue(pending(daysAgo(8))),
        update,
      },
      familyMemberCareScope: { deleteMany: jest.fn() },
    };
    await expect(
      repoWithTx(tx).transitionInvitation('inv-1', 'user-1', 'accepted'),
    ).resolves.toEqual({ outcome: 'expired' });
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses to accept an invitation when invitee has no dateOfBirth', async () => {
    const update = jest.fn();
    const tx = {
      familyMember: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            pending(daysAgo(1), { profile: { dateOfBirth: null } }),
          ),
        update,
      },
      familyMemberCareScope: { deleteMany: jest.fn() },
    };
    await expect(
      repoWithTx(tx).transitionInvitation('inv-1', 'user-1', 'accepted'),
    ).resolves.toEqual({ outcome: 'dob_required' });
    expect(update).not.toHaveBeenCalled();
  });

  it('auto-enables isCareRecipient for senior (>= 60) when careRecipientSetBy is null, and respects explicit false', async () => {
    const updateAuto = jest.fn().mockResolvedValue({ id: 'inv-1' });
    const txAuto = {
      familyMember: {
        findUnique: jest.fn().mockResolvedValue(
          pending(daysAgo(1), {
            isCareRecipient: false,
            careRecipientSetBy: null,
            profile: { dateOfBirth: SENIOR_DOB },
          }),
        ),
        update: updateAuto,
      },
      familyMemberCareScope: { deleteMany: jest.fn() },
    };
    await expect(
      repoWithTx(txAuto).transitionInvitation('inv-1', 'user-1', 'accepted'),
    ).resolves.toMatchObject({ outcome: 'updated' });
    expect(updateAuto.mock.calls[0][0].data).toMatchObject({
      isCareRecipient: true,
      careRecipientSetBy: 'inviter-1',
    });

    const updateExplicitFalse = jest.fn().mockResolvedValue({ id: 'inv-1' });
    const txExplicitFalse = {
      familyMember: {
        findUnique: jest.fn().mockResolvedValue(
          pending(daysAgo(1), {
            isCareRecipient: false,
            careRecipientSetBy: 'inviter-1',
            profile: { dateOfBirth: SENIOR_DOB },
          }),
        ),
        update: updateExplicitFalse,
      },
      familyMemberCareScope: { deleteMany: jest.fn() },
    };
    await repoWithTx(txExplicitFalse).transitionInvitation(
      'inv-1',
      'user-1',
      'accepted',
    );
    expect(updateExplicitFalse.mock.calls[0][0].data).toMatchObject({
      isCareRecipient: false,
      careRecipientSetBy: null,
    });
  });

  it('strips canManageCare when a minor (< 18) accepts an invitation', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'inv-1' });
    const tx = {
      familyMember: {
        findUnique: jest.fn().mockResolvedValue(
          pending(daysAgo(1), {
            canManageCare: true,
            careGrantedBy: 'inviter-1',
            isCareRecipient: true,
            careRecipientSetBy: 'inviter-1',
            profile: { dateOfBirth: MINOR_DOB },
          }),
        ),
        update,
      },
      familyMemberCareScope: { deleteMany: jest.fn() },
    };
    await repoWithTx(tx).transitionInvitation('inv-1', 'user-1', 'accepted');
    expect(update.mock.calls[0][0].data).toMatchObject({
      canManageCare: false,
      careGrantedBy: null,
      isCareRecipient: false,
      careRecipientSetBy: null,
    });
  });

  it('still lets the invitee reject an expired invitation', async () => {
    const tx = {
      familyMember: {
        findUnique: jest.fn().mockResolvedValue(pending(daysAgo(30))),
        update: jest.fn().mockResolvedValue({ id: 'inv-1' }),
      },
      familyMemberCareScope: { deleteMany: jest.fn() },
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
    const repo = repoWithTx({
      familyMember: { findFirst: find, update },
      familyMemberCareScope: { deleteMany: jest.fn() },
    });

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

describe('FamiliesRepository joinByInviteCode (join request flow)', () => {
  const family = {
    id: 'family-1',
    familyName: 'Gia đình A',
    ownerUserId: 'owner',
    status: 'active',
  };
  const dto = { code: 'ABCD2345', familyLabel: 'daughter' as const };

  function joinTx(
    existing: { id: string; status: string; invitedAt?: Date } | null,
    dob: Date | null = ADULT_DOB,
  ) {
    const create = jest.fn().mockResolvedValue({
      id: 'new',
      status: 'requested',
      invitedAt: new Date(),
    });
    const update = jest.fn().mockResolvedValue({
      id: 'old',
      status: 'requested',
      invitedAt: new Date(),
    });
    const findFirst = jest.fn().mockResolvedValue(family);
    const tx = {
      profile: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', dateOfBirth: dob }),
      },
      family: { findFirst },
      familyMember: {
        findUnique: jest.fn().mockResolvedValue(existing),
        findMany: jest.fn().mockResolvedValue([{ userId: 'owner' }]),
        create,
        update,
      },
      familyMemberCareScope: { deleteMany: jest.fn() },
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

  it('requires dateOfBirth before requesting to join', async () => {
    const { repo, create } = joinTx(null, null);
    await expect(
      repo.joinByInviteCode('user-1', 'ABCD2345', dto),
    ).resolves.toEqual({ outcome: 'dob_required' });
    expect(create).not.toHaveBeenCalled();
  });

  it('reports an unknown, expired or replaced code', async () => {
    const { repo, findFirst, create } = joinTx(null);
    findFirst.mockResolvedValue(null);
    await expect(
      repo.joinByInviteCode('user-1', 'NOPE2345', dto),
    ).resolves.toEqual({ outcome: 'invalid_code' });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a requested membership awaiting approval and returns admin recipients', async () => {
    const { repo, create } = joinTx(null);
    await expect(
      repo.joinByInviteCode('user-1', 'ABCD2345', dto),
    ).resolves.toMatchObject({
      outcome: 'requested',
      adminUserIds: ['owner'],
    });
    expect(create.mock.calls[0][0].data).toMatchObject({
      familyId: 'family-1',
      userId: 'user-1',
      familyLabel: 'daughter',
      status: 'requested',
      canManageCare: false,
      isCareRecipient: false,
      invitedByUserId: null,
      removedAt: null,
    });
  });

  it('is idempotent when an unexpired requested row already exists', async () => {
    const existing = {
      id: 'req-1',
      status: 'requested',
      invitedAt: daysAgo(1),
    };
    const { repo, create, update } = joinTx(existing);
    await expect(
      repo.joinByInviteCode('user-1', 'ABCD2345', dto),
    ).resolves.toMatchObject({
      outcome: 'already_requested',
      membership: existing,
    });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
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
    'turns an existing %s row into a requested membership',
    async (status) => {
      const { repo, create, update } = joinTx({ id: 'm', status });
      await expect(
        repo.joinByInviteCode('user-1', 'ABCD2345', dto),
      ).resolves.toMatchObject({ outcome: 'requested' });
      expect(create).not.toHaveBeenCalled();
      expect(update.mock.calls[0][0]).toMatchObject({
        where: { id: 'm' },
        data: { status: 'requested', familyLabel: 'daughter', removedAt: null },
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
      status: string;
      profile?: { dateOfBirth: Date | null };
    } | null;
  }) {
    const memberUpdate = jest.fn().mockResolvedValue({});
    const familyUpdate = jest.fn().mockResolvedValue({ id: 'f' });
    const scopeDelete = jest.fn().mockResolvedValue({});
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
      familyMemberCareScope: {
        deleteMany: scopeDelete,
      },
    };
    return {
      repo: repoWithTx(tx),
      memberUpdate,
      familyUpdate,
      scopeDelete,
    };
  }
  const target = (
    dateOfBirth: Date | null,
    status = 'accepted',
    userId = 'target',
  ) => ({
    id: 'tm',
    userId,
    status,
    profile: { dateOfBirth },
  });

  it.each([
    ['adult', ADULT_DOB],
    ['senior', SENIOR_DOB],
  ])(
    'hands over to an accepted %s, sets canManageCare = true, and clears care scopes',
    async (_label, dob) => {
      const { repo, memberUpdate, familyUpdate, scopeDelete } = transferTx({
        target: target(dob),
      });
      await expect(
        repo.transferOwnership('f', 'owner', 'tm'),
      ).resolves.toMatchObject({ outcome: 'transferred' });
      expect(scopeDelete).toHaveBeenCalledWith({
        where: { memberId: 'tm' },
      });
      expect(memberUpdate.mock.calls[0][0].data).toMatchObject({
        canManageCare: true,
        careGrantedBy: 'owner',
      });
      expect(familyUpdate.mock.calls[0][0].data.ownerUserId).toBe('target');
    },
  );

  it.each([
    ['minor (< 18)', target(MINOR_DOB)],
    ['self', target(ADULT_DOB, 'accepted', 'owner')],
    ['not accepted', target(ADULT_DOB, 'pending')],
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
      target: target(ADULT_DOB),
    });
    await expect(repo.transferOwnership('f', 'owner', 'tm')).resolves.toEqual({
      outcome: 'not_owner',
    });
    expect(familyUpdate).not.toHaveBeenCalled();
  });
});
