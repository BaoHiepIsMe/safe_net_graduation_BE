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
