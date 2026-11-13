import { FamiliesService } from './families.service';
import { FamiliesRepository } from './families.repository';
import { FamilyAccessService } from './family-access.service';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/app.error';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const FAMILY_ID = '33333333-3333-4333-8333-333333333333';
const MEMBER_ID = '44444444-4444-4444-8444-444444444444';

const family = {
  id: FAMILY_ID,
  familyName: 'Gia đình An',
  ownerUserId: OWNER_ID,
  avatarUrl: null,
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const member = {
  id: MEMBER_ID,
  familyId: FAMILY_ID,
  userId: USER_ID,
  role: 'adult',
  familyLabel: 'other',
  displayName: null,
  status: 'accepted',
  locationSharingEnabled: true,
  invitedAt: new Date(),
  acceptedAt: new Date(),
  removedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  profile: { id: USER_ID, fullName: 'User B', avatarUrl: null },
};

function setup() {
  const repository: any = {
    createFamilyWithOwner: jest.fn(),
    updateFamily: jest.fn(),
    archiveFamily: jest.fn(),
    findMember: jest.fn(),
    updateMemberWithManagerInvariant: jest.fn(),
    removeMemberWithManagerInvariant: jest.fn(),
    findProfileByInvitationTarget: jest.fn(),
    findMembershipForUser: jest.fn(),
    createInvitation: jest.fn(),
    renewInvitation: jest.fn(),
    transitionInvitation: jest.fn(),
    listPendingInvitations: jest.fn(),
    listSentInvitations: jest.fn(),
    cancelInvitation: jest.fn(),
    resendInvitation: jest.fn(),
    getOrCreateInviteCode: jest.fn(),
    regenerateInviteCode: jest.fn(),
    joinByInviteCode: jest.fn(),
    transferOwnership: jest.fn(),
  };
  const access: any = {
    requireAcceptedMember: jest.fn(),
    requireManager: jest.fn().mockResolvedValue({
      id: 'owner-member',
      userId: OWNER_ID,
      role: 'manager',
      family,
    }),
    requireOwner: jest.fn().mockResolvedValue({
      id: 'owner-member',
      userId: OWNER_ID,
      role: 'manager',
      family,
    }),
  };
  return {
    repository,
    access,
    service: new FamiliesService(
      repository as FamiliesRepository,
      access as FamilyAccessService,
    ),
  };
}

describe('FamiliesService', () => {
  it('returns the accepted manager created by the family transaction', async () => {
    const { service, repository } = setup();
    repository.createFamilyWithOwner.mockResolvedValue({
      family,
      membership: { ...member, userId: OWNER_ID, role: 'manager' },
    });
    await expect(
      service.createFamily(OWNER_ID, {
        familyName: family.familyName,
        familyLabel: 'caregiver',
      }),
    ).resolves.toMatchObject({
      id: FAMILY_ID,
      membership: { role: 'manager', status: 'accepted' },
    });
  });

  it('allows a manager to update a family', async () => {
    const { service, repository, access } = setup();
    repository.updateFamily.mockResolvedValue({
      ...family,
      familyName: 'Tên mới',
    });
    await expect(
      service.updateFamily(OWNER_ID, FAMILY_ID, { familyName: 'Tên mới' }),
    ).resolves.toMatchObject({ familyName: 'Tên mới' });
    expect(access.requireManager).toHaveBeenCalled();
  });

  it('denies a non-manager family update', async () => {
    const { service, access } = setup();
    access.requireManager.mockRejectedValue(new ForbiddenError());
    await expect(
      service.updateFamily(USER_ID, FAMILY_ID, { familyName: 'Tên mới' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('creates a valid pending invitation', async () => {
    const { service, repository } = setup();
    repository.findProfileByInvitationTarget.mockResolvedValue({
      id: USER_ID,
      accountStatus: 'active',
    });
    repository.findMembershipForUser.mockResolvedValue(null);
    repository.createInvitation.mockResolvedValue({
      ...member,
      status: 'pending',
      acceptedAt: null,
    });
    await expect(
      service.createInvitation(OWNER_ID, FAMILY_ID, {
        email: 'user@example.com',
        familyLabel: 'other',
        role: 'adult',
      }),
    ).resolves.toMatchObject({ status: 'pending' });
  });

  it('denies inviting yourself', async () => {
    const { service, repository } = setup();
    repository.findProfileByInvitationTarget.mockResolvedValue({
      id: OWNER_ID,
      accountStatus: 'active',
    });
    await expect(
      service.createInvitation(OWNER_ID, FAMILY_ID, {
        email: 'owner@example.com',
        familyLabel: 'caregiver',
        role: 'adult',
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it.each([
    ['pending', 'invitation'],
    ['accepted', 'member'],
  ])('rejects duplicate %s membership state', async (status) => {
    const { service, repository } = setup();
    repository.findProfileByInvitationTarget.mockResolvedValue({
      id: USER_ID,
      accountStatus: 'active',
    });
    repository.findMembershipForUser.mockResolvedValue({ ...member, status });
    await expect(
      service.createInvitation(OWNER_ID, FAMILY_ID, {
        email: 'user@example.com',
        familyLabel: 'other',
        role: 'adult',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('denies an unauthorized inviter', async () => {
    const { service, access } = setup();
    access.requireManager.mockRejectedValue(new ForbiddenError());
    await expect(
      service.createInvitation(USER_ID, FAMILY_ID, {
        email: 'target@example.com',
        familyLabel: 'other',
        role: 'adult',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it.each([
    ['accept', 'accepted'],
    ['reject', 'rejected'],
  ] as const)('processes invitation %s', async (action, status) => {
    const { service, repository } = setup();
    repository.transitionInvitation.mockResolvedValue({
      outcome: 'updated',
      membership: { ...member, status },
    });
    await expect(
      action === 'accept'
        ? service.acceptInvitation(USER_ID, MEMBER_ID)
        : service.rejectInvitation(USER_ID, MEMBER_ID),
    ).resolves.toMatchObject({ status });
  });

  it('denies accepting someone else invitation', async () => {
    const { service, repository } = setup();
    repository.transitionInvitation.mockResolvedValue({
      outcome: 'forbidden',
    });
    await expect(
      service.acceptInvitation(USER_ID, MEMBER_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it.each(['accepted', 'rejected'])(
    'rejects accepting an invitation already %s',
    async () => {
      const { service, repository } = setup();
      repository.transitionInvitation.mockResolvedValue({
        outcome: 'invalid_state',
      });
      await expect(
        service.acceptInvitation(USER_ID, MEMBER_ID),
      ).rejects.toBeInstanceOf(BusinessRuleError);
    },
  );

  it('allows a manager to update a permitted target', async () => {
    const { service, repository } = setup();
    repository.findMember.mockResolvedValue(member);
    repository.updateMemberWithManagerInvariant.mockResolvedValue({
      outcome: 'updated',
      member: { ...member, role: 'child' },
    });
    await expect(
      service.updateMember(OWNER_ID, FAMILY_ID, MEMBER_ID, { role: 'child' }),
    ).resolves.toMatchObject({ role: 'child' });
  });

  it('denies a non-manager member from changing another member role', async () => {
    const { service, access } = setup();
    access.requireManager.mockRejectedValue(new ForbiddenError());
    await expect(
      service.updateMember(USER_ID, FAMILY_ID, MEMBER_ID, { role: 'manager' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('denies self role changes', async () => {
    const { service, repository, access } = setup();
    access.requireManager.mockResolvedValue({
      id: MEMBER_ID,
      userId: USER_ID,
      role: 'manager',
      family,
    });
    repository.findMember.mockResolvedValue({ ...member, role: 'manager' });
    await expect(
      service.updateMember(USER_ID, FAMILY_ID, MEMBER_ID, { role: 'adult' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('denies modification of a foreign-family member', async () => {
    const { service, repository } = setup();
    repository.findMember.mockResolvedValue(null);
    await expect(
      service.updateMember(OWNER_ID, FAMILY_ID, MEMBER_ID, { role: 'child' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('removes an allowed member', async () => {
    const { service, repository } = setup();
    repository.findMember.mockResolvedValue(member);
    repository.removeMemberWithManagerInvariant.mockResolvedValue({
      outcome: 'removed',
    });
    await expect(
      service.removeMember(OWNER_ID, FAMILY_ID, MEMBER_ID),
    ).resolves.toBeUndefined();
  });

  it('protects the last manager invariant', async () => {
    const { service, repository, access } = setup();
    const secondManager = {
      ...member,
      role: 'manager',
      userId: '55555555-5555-4555-8555-555555555555',
    };
    access.requireManager.mockResolvedValue({
      id: 'owner-member',
      userId: OWNER_ID,
      role: 'manager',
      family,
    });
    repository.findMember.mockResolvedValue(secondManager);
    repository.removeMemberWithManagerInvariant.mockResolvedValue({
      outcome: 'last_manager',
    });
    await expect(
      service.removeMember(OWNER_ID, FAMILY_ID, MEMBER_ID),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const OTHER_ID = '55555555-5555-4555-8555-555555555555';

describe('FamiliesService invitations (P2)', () => {
  const inviteTarget = (s: ReturnType<typeof setup>) => {
    s.repository.findProfileByInvitationTarget.mockResolvedValue({
      id: USER_ID,
      accountStatus: 'active',
    });
  };

  it.each([
    ['grandmother', 'elder'],
    ['daughter', 'child'],
    ['caregiver', 'adult'],
  ] as const)(
    'derives role from %s when none is sent',
    async (familyLabel, role) => {
      const s = setup();
      inviteTarget(s);
      s.repository.findMembershipForUser.mockResolvedValue(null);
      s.repository.createInvitation.mockResolvedValue({
        ...member,
        role,
        status: 'pending',
      });
      await s.service.createInvitation(OWNER_ID, FAMILY_ID, {
        email: 'u@example.com',
        familyLabel,
      });
      expect(s.repository.createInvitation).toHaveBeenCalledWith(
        FAMILY_ID,
        USER_ID,
        OWNER_ID,
        expect.objectContaining({ role }),
      );
    },
  );

  it('keeps an explicit role', async () => {
    const s = setup();
    inviteTarget(s);
    s.repository.findMembershipForUser.mockResolvedValue(null);
    s.repository.createInvitation.mockResolvedValue({ ...member });
    await s.service.createInvitation(OWNER_ID, FAMILY_ID, {
      email: 'u@example.com',
      familyLabel: 'grandmother',
      role: 'adult',
    });
    expect(s.repository.createInvitation).toHaveBeenCalledWith(
      FAMILY_ID,
      USER_ID,
      OWNER_ID,
      expect.objectContaining({ role: 'adult' }),
    );
  });

  it('renews a pending invitation that has expired', async () => {
    const s = setup();
    inviteTarget(s);
    s.repository.findMembershipForUser.mockResolvedValue({
      ...member,
      status: 'pending',
      invitedAt: daysAgo(8),
    });
    s.repository.renewInvitation.mockResolvedValue({
      ...member,
      status: 'pending',
      invitedAt: new Date(),
    });
    await expect(
      s.service.createInvitation(OWNER_ID, FAMILY_ID, {
        email: 'u@example.com',
        familyLabel: 'other',
      }),
    ).resolves.toMatchObject({ status: 'pending', isExpired: false });
    expect(s.repository.renewInvitation).toHaveBeenCalled();
  });

  it('rejects a pending invitation that is still valid with 409', async () => {
    const s = setup();
    inviteTarget(s);
    s.repository.findMembershipForUser.mockResolvedValue({
      ...member,
      status: 'pending',
      invitedAt: daysAgo(6),
    });
    await expect(
      s.service.createInvitation(OWNER_ID, FAMILY_ID, {
        email: 'u@example.com',
        familyLabel: 'other',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('adds expiresAt to the invitee pending list', async () => {
    const s = setup();
    const invitedAt = daysAgo(1);
    s.repository.listPendingInvitations.mockResolvedValue({
      invitations: [
        {
          id: MEMBER_ID,
          role: 'adult',
          familyLabel: 'other',
          displayName: null,
          invitedAt,
          family,
          inviter: null,
        },
      ],
      total: 1,
    });
    const res = await s.service.listPendingInvitations(USER_ID, {
      page: 1,
      limit: 20,
    });
    expect(res.data[0].expiresAt).toEqual(
      new Date(invitedAt.getTime() + 7 * DAY),
    );
  });

  it('maps an expired accept to FAMILY_INVITATION_EXPIRED', async () => {
    const s = setup();
    s.repository.transitionInvitation.mockResolvedValue({ outcome: 'expired' });
    await expect(
      s.service.acceptInvitation(USER_ID, MEMBER_ID),
    ).rejects.toMatchObject({
      response: { error: { code: 'FAMILY_INVITATION_EXPIRED' } },
    });
  });

  it('lists sent invitations with expiry flags for a manager', async () => {
    const s = setup();
    s.repository.listSentInvitations.mockResolvedValue({
      invitations: [
        { ...member, status: 'pending', invitedAt: daysAgo(9), inviter: null },
        { ...member, status: 'pending', invitedAt: daysAgo(1), inviter: null },
      ],
      total: 2,
    });
    const res = await s.service.listSentInvitations(OWNER_ID, FAMILY_ID, {
      page: 1,
      limit: 20,
    });
    expect(res.data.map((i) => i.isExpired)).toEqual([true, false]);
    expect(s.access.requireManager).toHaveBeenCalledWith(OWNER_ID, FAMILY_ID);
  });

  it('denies sent invitations, cancel, resend and invite code to non-managers', async () => {
    const s = setup();
    s.access.requireManager.mockRejectedValue(new ForbiddenError());
    const page = { page: 1, limit: 20 };
    await expect(
      s.service.listSentInvitations(USER_ID, FAMILY_ID, page),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      s.service.cancelInvitation(USER_ID, FAMILY_ID, MEMBER_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      s.service.resendInvitation(USER_ID, FAMILY_ID, MEMBER_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      s.service.getInviteCode(USER_ID, FAMILY_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      s.service.regenerateInviteCode(USER_ID, FAMILY_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(s.repository.getOrCreateInviteCode).not.toHaveBeenCalled();
  });

  it('cancels a pending invitation', async () => {
    const s = setup();
    s.repository.cancelInvitation.mockResolvedValue({ outcome: 'cancelled' });
    await expect(
      s.service.cancelInvitation(OWNER_ID, FAMILY_ID, MEMBER_ID),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['not_found', NotFoundError],
    ['invalid_state', BusinessRuleError],
  ] as const)('cancel maps %s', async (outcome, errorClass) => {
    const s = setup();
    s.repository.cancelInvitation.mockResolvedValue({ outcome });
    await expect(
      s.service.cancelInvitation(OWNER_ID, FAMILY_ID, MEMBER_ID),
    ).rejects.toBeInstanceOf(errorClass);
  });

  it('resends an expired invitation and returns it valid again', async () => {
    const s = setup();
    s.repository.resendInvitation.mockResolvedValue({
      outcome: 'resent',
      member: { ...member, status: 'pending', invitedAt: new Date() },
    });
    await expect(
      s.service.resendInvitation(OWNER_ID, FAMILY_ID, MEMBER_ID),
    ).resolves.toMatchObject({ isExpired: false });
    expect(s.repository.resendInvitation).toHaveBeenCalledWith(
      FAMILY_ID,
      MEMBER_ID,
      OWNER_ID,
    );
  });

  it('resend of a non-pending invitation is FAMILY_INVITATION_INVALID_STATE', async () => {
    const s = setup();
    s.repository.resendInvitation.mockResolvedValue({
      outcome: 'invalid_state',
    });
    await expect(
      s.service.resendInvitation(OWNER_ID, FAMILY_ID, MEMBER_ID),
    ).rejects.toMatchObject({
      response: { error: { code: 'FAMILY_INVITATION_INVALID_STATE' } },
    });
  });
});

describe('FamiliesService invite code and join (P2)', () => {
  const joinResult = {
    outcome: 'joined',
    family,
    membership: { ...member, role: 'child', familyLabel: 'daughter' },
  };

  it('returns the code for a manager', async () => {
    const s = setup();
    const code = { code: 'ABCD2345', expiresAt: new Date() };
    s.repository.getOrCreateInviteCode.mockResolvedValue(code);
    s.repository.regenerateInviteCode.mockResolvedValue(code);
    await expect(s.service.getInviteCode(OWNER_ID, FAMILY_ID)).resolves.toBe(
      code,
    );
    await expect(
      s.service.regenerateInviteCode(OWNER_ID, FAMILY_ID),
    ).resolves.toBe(code);
  });

  it('joins and returns the family with the new membership', async () => {
    const s = setup();
    s.repository.joinByInviteCode.mockResolvedValue(joinResult);
    await expect(
      s.service.joinByCode(USER_ID, {
        code: 'ABCD2345',
        familyLabel: 'daughter',
      }),
    ).resolves.toMatchObject({
      id: FAMILY_ID,
      membership: { role: 'child', status: 'accepted' },
    });
  });

  it('normalises a lowercase code with spaces', async () => {
    const s = setup();
    s.repository.joinByInviteCode.mockResolvedValue(joinResult);
    await s.service.joinByCode(USER_ID, {
      code: '  abcd2345 ',
      familyLabel: 'son',
    });
    expect(s.repository.joinByInviteCode).toHaveBeenCalledWith(
      USER_ID,
      'ABCD2345',
      expect.any(Object),
    );
  });

  it('wrong, expired, replaced or archived code is 404 FAMILY_INVITE_CODE_INVALID', async () => {
    const s = setup();
    s.repository.joinByInviteCode.mockResolvedValue({
      outcome: 'invalid_code',
    });
    const err = await s.service
      .joinByCode(USER_ID, { code: 'NOPE2345', familyLabel: 'other' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err).toMatchObject({
      response: { error: { code: 'FAMILY_INVITE_CODE_INVALID' } },
    });
  });

  it('an existing member joining again is 409', async () => {
    const s = setup();
    s.repository.joinByInviteCode.mockResolvedValue({
      outcome: 'already_member',
    });
    await expect(
      s.service.joinByCode(USER_ID, { code: 'ABCD2345', familyLabel: 'other' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('FamiliesService leave and transfer ownership (P2)', () => {
  const asMember = (
    s: ReturnType<typeof setup>,
    userId: string,
    role: string,
  ) =>
    s.access.requireAcceptedMember.mockResolvedValue({
      id: MEMBER_ID,
      userId,
      role,
      family,
    });
  const code = (e: unknown) =>
    (e as { response: { error: { code: string } } }).response.error.code;

  it.each(['adult', 'elder', 'manager'])(
    'lets a non-owner %s leave',
    async (role) => {
      const s = setup();
      asMember(s, USER_ID, role);
      s.repository.removeMemberWithManagerInvariant.mockResolvedValue({
        outcome: 'removed',
      });
      await expect(
        s.service.leaveFamily(USER_ID, FAMILY_ID),
      ).resolves.toBeUndefined();
      expect(
        s.repository.removeMemberWithManagerInvariant,
      ).toHaveBeenCalledWith(FAMILY_ID, MEMBER_ID);
    },
  );

  it('forbids a child from leaving', async () => {
    const s = setup();
    asMember(s, USER_ID, 'child');
    const err = await s.service
      .leaveFamily(USER_ID, FAMILY_ID)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(code(err)).toBe('CHILD_CANNOT_LEAVE_FAMILY');
    expect(
      s.repository.removeMemberWithManagerInvariant,
    ).not.toHaveBeenCalled();
  });

  it('forbids the owner from leaving', async () => {
    const s = setup();
    asMember(s, OWNER_ID, 'manager');
    const err = await s.service
      .leaveFamily(OWNER_ID, FAMILY_ID)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(code(err)).toBe('FAMILY_OWNER_CANNOT_LEAVE');
  });

  it('transfers ownership to an adult', async () => {
    const s = setup();
    s.repository.transferOwnership.mockResolvedValue({
      outcome: 'transferred',
      family: { ...family, ownerUserId: USER_ID },
    });
    await expect(
      s.service.transferOwnership(OWNER_ID, FAMILY_ID, { memberId: MEMBER_ID }),
    ).resolves.toMatchObject({ ownerUserId: USER_ID });
    expect(s.access.requireOwner).toHaveBeenCalledWith(OWNER_ID, FAMILY_ID);
  });

  it('rejects an invalid transfer target', async () => {
    const s = setup();
    s.repository.transferOwnership.mockResolvedValue({
      outcome: 'invalid_target',
    });
    const err = await s.service
      .transferOwnership(OWNER_ID, FAMILY_ID, { memberId: OTHER_ID })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusinessRuleError);
    expect(code(err)).toBe('OWNERSHIP_TRANSFER_TARGET_INVALID');
  });

  it('a non-owner manager cannot transfer', async () => {
    const s = setup();
    s.access.requireOwner.mockRejectedValue(new ForbiddenError());
    await expect(
      s.service.transferOwnership(USER_ID, FAMILY_ID, { memberId: MEMBER_ID }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(s.repository.transferOwnership).not.toHaveBeenCalled();
  });

  it('an owner racing out of ownership is forbidden', async () => {
    const s = setup();
    s.repository.transferOwnership.mockResolvedValue({ outcome: 'not_owner' });
    await expect(
      s.service.transferOwnership(OWNER_ID, FAMILY_ID, { memberId: MEMBER_ID }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
