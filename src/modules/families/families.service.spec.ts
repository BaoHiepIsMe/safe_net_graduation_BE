import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/app.error';
import { NotificationsService } from '../notifications/notifications.service';
import { FamiliesRepository } from './families.repository';
import { FamiliesService } from './families.service';
import { FamilyAccessService } from './family-access.service';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const FAMILY_ID = '33333333-3333-4333-8333-333333333333';
const MEMBER_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_ID = '55555555-5555-4555-8555-555555555555';

const ADULT_DOB = new Date('1995-03-10T00:00:00.000Z');
const SENIOR_DOB = new Date('1955-08-20T00:00:00.000Z');
const MINOR_DOB = new Date('2015-04-05T00:00:00.000Z');

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
  familyLabel: 'other',
  displayName: null,
  status: 'accepted',
  canManageCare: false,
  careGrantedBy: null,
  isCareRecipient: false,
  careRecipientSetBy: null,
  isHired: false,
  careScopes: [],
  locationSharingEnabled: true,
  invitedAt: new Date(),
  acceptedAt: new Date(),
  removedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  family,
  profile: {
    id: USER_ID,
    fullName: 'User B',
    avatarUrl: null,
    gender: 'female',
    dateOfBirth: ADULT_DOB,
  },
};

function setup() {
  const repository: any = {
    createFamilyWithOwner: jest.fn(),
    listFamilies: jest.fn(),
    updateFamily: jest.fn(),
    archiveFamily: jest.fn(),
    listMembers: jest.fn(),
    findMember: jest.fn(),
    updateMemberWithManagerInvariant: jest.fn(),
    removeMemberWithManagerInvariant: jest.fn(),
    findProfileByInvitationTarget: jest.fn(),
    findMembershipForUser: jest.fn(),
    validateCareScopeMembers: jest.fn().mockResolvedValue(true),
    createInvitation: jest.fn(),
    renewInvitation: jest.fn(),
    transitionInvitation: jest.fn(),
    listPendingInvitations: jest.fn(),
    listSentInvitations: jest.fn(),
    cancelInvitation: jest.fn(),
    resendInvitation: jest.fn(),
    getOrCreateInviteCode: jest.fn(),
    regenerateInviteCode: jest.fn(),
    findJoinPreviewByCode: jest.fn(),
    joinByInviteCode: jest.fn(),
    listJoinRequests: jest.fn(),
    listOwnJoinRequests: jest.fn(),
    approveJoinRequest: jest.fn(),
    rejectJoinRequest: jest.fn(),
    cancelJoinRequest: jest.fn(),
    transferOwnership: jest.fn(),
    listAcceptedFamilyMemberUserIds: jest
      .fn()
      .mockResolvedValue([OWNER_ID, USER_ID]),
    findAcceptedCareManagersInFamily: jest
      .fn()
      .mockResolvedValue([{ id: 'owner-member', userId: OWNER_ID }]),
  };
  const ownerActor = {
    id: 'owner-member',
    userId: OWNER_ID,
    canManageCare: true,
    isHired: false,
    family,
  };
  const access: any = {
    requireAcceptedMember: jest.fn().mockResolvedValue(ownerActor),
    requireCareManager: jest.fn().mockResolvedValue(ownerActor),
    requireFamilyAdmin: jest.fn().mockResolvedValue(ownerActor),
    requireOwner: jest.fn().mockResolvedValue(ownerActor),
    listManagersFor: jest.fn().mockResolvedValue([{ userId: OWNER_ID }]),
  };
  const notifications: any = {
    notifyFamilyEvent: jest.fn().mockResolvedValue([]),
  };
  return {
    repository,
    access,
    notifications,
    service: new FamiliesService(
      repository as FamiliesRepository,
      access as FamilyAccessService,
      notifications as NotificationsService,
    ),
  };
}

describe('FamiliesService', () => {
  it('returns the accepted care manager created by the family transaction', async () => {
    const { service, repository } = setup();
    repository.createFamilyWithOwner.mockResolvedValue({
      outcome: 'created',
      family,
      membership: {
        ...member,
        userId: OWNER_ID,
        canManageCare: true,
        isHired: true,
        familyLabel: 'caregiver',
      },
    });
    await expect(
      service.createFamily(OWNER_ID, {
        familyName: family.familyName,
        familyLabel: 'caregiver',
      }),
    ).resolves.toMatchObject({
      id: FAMILY_ID,
      membership: {
        isOwner: true,
        canManageCare: true,
        isHired: true,
        status: 'accepted',
      },
    });
  });

  it('rejects family creation when profile has no dateOfBirth or is under 18', async () => {
    const { service, repository } = setup();
    repository.createFamilyWithOwner.mockResolvedValueOnce({
      outcome: 'dob_required',
    });
    await expect(
      service.createFamily(OWNER_ID, {
        familyName: family.familyName,
        familyLabel: 'father',
      }),
    ).rejects.toMatchObject({
      response: { error: { code: 'PROFILE_DATE_OF_BIRTH_REQUIRED' } },
    });

    repository.createFamilyWithOwner.mockResolvedValueOnce({
      outcome: 'minor_forbidden',
    });
    await expect(
      service.createFamily(OWNER_ID, {
        familyName: family.familyName,
        familyLabel: 'son',
      }),
    ).rejects.toMatchObject({
      response: { error: { code: 'MINOR_CANNOT_CREATE_FAMILY' } },
    });
  });

  it('maps member flags per Section 9 and never exposes dateOfBirth of members', async () => {
    const { service, repository } = setup();
    repository.listMembers.mockResolvedValue({
      members: [
        {
          ...member,
          profile: {
            ...member.profile,
            gender: 'female',
            dateOfBirth: MINOR_DOB,
          },
        },
      ],
      total: 1,
    });
    const res = await service.listMembers(OWNER_ID, FAMILY_ID, {
      page: 1,
      limit: 20,
    });
    expect(res.data[0]).toMatchObject({
      id: MEMBER_ID,
      isOwner: false,
      canManageCare: false,
      isCareRecipient: true,
      isMinor: true,
      isHired: false,
      careScopeMemberIds: [],
      locationSharingEnabled: true,
      profile: {
        gender: 'female',
      },
    });
    expect(res.data[0].profile).not.toHaveProperty('dateOfBirth');
    expect(res.data[0]).not.toHaveProperty('role');
  });

  it('hides gender for non-accepted members', async () => {
    const { service, repository } = setup();
    repository.findProfileByInvitationTarget.mockResolvedValue({
      id: USER_ID,
      accountStatus: 'active',
      dateOfBirth: ADULT_DOB,
    });
    repository.findMembershipForUser.mockResolvedValue(null);
    repository.createInvitation.mockResolvedValue({
      ...member,
      status: 'pending',
      acceptedAt: null,
    });
    const invited = await service.createInvitation(OWNER_ID, FAMILY_ID, {
      email: 'u@example.com',
      familyLabel: 'other',
    });
    expect(invited.profile).toEqual({
      id: USER_ID,
      fullName: 'User B',
      avatarUrl: null,
      gender: null,
    });
  });

  it('allows a family admin to update a family', async () => {
    const { service, repository, access } = setup();
    repository.updateFamily.mockResolvedValue({
      ...family,
      familyName: 'Tên mới',
    });
    await expect(
      service.updateFamily(OWNER_ID, FAMILY_ID, { familyName: 'Tên mới' }),
    ).resolves.toMatchObject({ familyName: 'Tên mới' });
    expect(access.requireFamilyAdmin).toHaveBeenCalled();
  });

  it('denies a non-admin family update', async () => {
    const { service, access } = setup();
    access.requireFamilyAdmin.mockRejectedValue(new ForbiddenError());
    await expect(
      service.updateFamily(USER_ID, FAMILY_ID, { familyName: 'Tên mới' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('creates a valid pending invitation with 3-state isCareRecipient', async () => {
    const { service, repository } = setup();
    repository.findProfileByInvitationTarget.mockResolvedValue({
      id: USER_ID,
      accountStatus: 'active',
      dateOfBirth: ADULT_DOB,
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
        familyLabel: 'husband',
        canManageCare: true,
      }),
    ).resolves.toMatchObject({ status: 'pending' });
    expect(repository.createInvitation).toHaveBeenCalledWith(
      FAMILY_ID,
      USER_ID,
      OWNER_ID,
      expect.objectContaining({
        familyLabel: 'husband',
        canManageCare: true,
        careGrantedBy: OWNER_ID,
        isCareRecipient: false,
        careRecipientSetBy: null, // omitted => auto on accept
      }),
    );
  });

  it('denies inviting yourself', async () => {
    const { service, repository } = setup();
    repository.findProfileByInvitationTarget.mockResolvedValue({
      id: OWNER_ID,
      accountStatus: 'active',
      dateOfBirth: ADULT_DOB,
    });
    await expect(
      service.createInvitation(OWNER_ID, FAMILY_ID, {
        email: 'owner@example.com',
        familyLabel: 'other',
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it.each([
    ['pending', 'invitation'],
    ['requested', 'join request'],
    ['accepted', 'member'],
  ])('rejects duplicate %s membership state', async (status) => {
    const { service, repository } = setup();
    repository.findProfileByInvitationTarget.mockResolvedValue({
      id: USER_ID,
      accountStatus: 'active',
      dateOfBirth: ADULT_DOB,
    });
    repository.findMembershipForUser.mockResolvedValue({ ...member, status });
    await expect(
      service.createInvitation(OWNER_ID, FAMILY_ID, {
        email: 'user@example.com',
        familyLabel: 'other',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows an admin to grant canManageCare or toggle isCareRecipient on an adult member and notifies the family', async () => {
    const { service, repository, notifications } = setup();
    repository.findMember.mockResolvedValue(member);
    repository.updateMemberWithManagerInvariant.mockResolvedValue({
      outcome: 'updated',
      member: { ...member, canManageCare: true, isCareRecipient: true },
    });
    await expect(
      service.updateMember(OWNER_ID, FAMILY_ID, MEMBER_ID, {
        canManageCare: true,
        isCareRecipient: true,
      }),
    ).resolves.toMatchObject({
      canManageCare: true,
      isCareRecipient: true,
    });
    expect(notifications.notifyFamilyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        familyId: FAMILY_ID,
        type: 'family_role_changed',
      }),
    );
  });

  it('denies self-toggling isCareRecipient, while allowing non-owner manager to step down from canManageCare', async () => {
    const { service, repository, access } = setup();
    access.requireAcceptedMember.mockResolvedValue({
      id: MEMBER_ID,
      userId: USER_ID,
      canManageCare: true,
      isHired: false,
      family,
    });
    repository.findMember.mockResolvedValue({
      ...member,
      canManageCare: true,
    });

    await expect(
      service.updateMember(USER_ID, FAMILY_ID, MEMBER_ID, {
        isCareRecipient: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    repository.updateMemberWithManagerInvariant.mockResolvedValue({
      outcome: 'updated',
      member: { ...member, canManageCare: false },
    });
    await expect(
      service.updateMember(USER_ID, FAMILY_ID, MEMBER_ID, {
        canManageCare: false,
      }),
    ).resolves.toMatchObject({ canManageCare: false });
  });

  it('denies a care recipient from disabling their own locationSharingEnabled', async () => {
    const { service, repository, access } = setup();
    access.requireAcceptedMember.mockResolvedValue({
      id: MEMBER_ID,
      userId: USER_ID,
      canManageCare: false,
      isHired: false,
      family,
    });
    repository.findMember.mockResolvedValue({
      ...member,
      isCareRecipient: true,
    });
    await expect(
      service.updateMember(USER_ID, FAMILY_ID, MEMBER_ID, {
        locationSharingEnabled: false,
      }),
    ).rejects.toMatchObject({
      response: {
        error: { code: 'CARE_RECIPIENT_CANNOT_DISABLE_LOCATION_SHARING' },
      },
    });
  });

  it('lets a plain member toggle their own sharing but not another member', async () => {
    const { service, repository, access } = setup();
    repository.findMember.mockResolvedValue(member);
    await expect(
      service.updateMember(OWNER_ID, FAMILY_ID, MEMBER_ID, {
        locationSharingEnabled: false,
      }),
    ).rejects.toMatchObject({
      response: { error: { code: 'MEMBER_ROLE_CHANGE_DENIED' } },
    });

    access.requireAcceptedMember.mockResolvedValue({
      id: MEMBER_ID,
      userId: USER_ID,
      canManageCare: false,
      isHired: false,
      family,
    });
    repository.updateMemberWithManagerInvariant.mockResolvedValue({
      outcome: 'updated',
      member: { ...member, locationSharingEnabled: false },
    });
    await expect(
      service.updateMember(USER_ID, FAMILY_ID, MEMBER_ID, {
        locationSharingEnabled: false,
      }),
    ).resolves.toMatchObject({ locationSharingEnabled: false });
  });

  it('stops a hired caregiver from relabelling themselves into a full manager', async () => {
    const { service, repository, access } = setup();
    const hired = {
      ...member,
      familyLabel: 'caregiver',
      canManageCare: true,
      isHired: true,
      careScopes: [{ targetMemberId: OTHER_ID }],
    };
    access.requireAcceptedMember.mockResolvedValue({ ...hired, family });
    repository.findMember.mockResolvedValue(hired);
    await expect(
      service.updateMember(USER_ID, FAMILY_ID, MEMBER_ID, {
        familyLabel: 'other',
      }),
    ).rejects.toMatchObject({
      response: { error: { code: 'MEMBER_ROLE_CHANGE_DENIED' } },
    });
    expect(repository.updateMemberWithManagerInvariant).not.toHaveBeenCalled();
  });

  it('removes management rights when an admin relabels a hired caregiver', async () => {
    const { service, repository } = setup();
    repository.findMember.mockResolvedValue({
      ...member,
      familyLabel: 'caregiver',
      canManageCare: true,
      isHired: true,
      careScopes: [{ targetMemberId: OTHER_ID }],
    });
    repository.updateMemberWithManagerInvariant.mockResolvedValue({
      outcome: 'updated',
      member,
    });
    await service.updateMember(OWNER_ID, FAMILY_ID, MEMBER_ID, {
      familyLabel: 'other',
    });
    expect(repository.updateMemberWithManagerInvariant).toHaveBeenCalledWith(
      FAMILY_ID,
      MEMBER_ID,
      expect.objectContaining({
        familyLabel: 'other',
        isHired: false,
        canManageCare: false,
        careGrantedBy: null,
        careScopeMemberIds: [],
      }),
    );
  });

  it('enforces removal rules: manager cannot remove another manager; hired owner cannot remove care recipient', async () => {
    const { service, repository, access } = setup();
    // Non-owner manager trying to remove another manager
    access.requireFamilyAdmin.mockResolvedValueOnce({
      id: 'mgr-2',
      userId: USER_ID,
      canManageCare: true,
      isHired: false,
      family,
    });
    repository.findMember.mockResolvedValueOnce({
      ...member,
      id: 'mgr-3',
      userId: OTHER_ID,
      canManageCare: true,
    });
    await expect(
      service.removeMember(USER_ID, FAMILY_ID, 'mgr-3'),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Hired owner trying to remove a care recipient
    access.requireFamilyAdmin.mockResolvedValueOnce({
      id: 'owner-member',
      userId: OWNER_ID,
      canManageCare: true,
      isHired: true,
      family,
    });
    repository.findMember.mockResolvedValueOnce({
      ...member,
      isCareRecipient: true,
    });
    await expect(
      service.removeMember(OWNER_ID, FAMILY_ID, MEMBER_ID),
    ).rejects.toMatchObject({
      response: {
        error: { code: 'HIRED_OWNER_CANNOT_REMOVE_CARE_RECIPIENT' },
      },
    });
  });
});

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

describe('FamiliesService invitations and join requests', () => {
  it('renews a pending invitation that has expired', async () => {
    const s = setup();
    s.repository.findProfileByInvitationTarget.mockResolvedValue({
      id: USER_ID,
      accountStatus: 'active',
      dateOfBirth: ADULT_DOB,
    });
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

  it('maps missing dateOfBirth on acceptInvitation to PROFILE_DATE_OF_BIRTH_REQUIRED', async () => {
    const s = setup();
    s.repository.transitionInvitation.mockResolvedValue({
      outcome: 'dob_required',
    });
    await expect(
      s.service.acceptInvitation(USER_ID, MEMBER_ID),
    ).rejects.toMatchObject({
      response: { error: { code: 'PROFILE_DATE_OF_BIRTH_REQUIRED' } },
    });
  });

  it('returns join preview for a live code and 404 for invalid/expired code', async () => {
    const s = setup();
    s.repository.findJoinPreviewByCode.mockResolvedValueOnce({
      familyId: FAMILY_ID,
      familyName: family.familyName,
      avatarUrl: null,
      memberCount: 3,
      owner: {
        userId: OWNER_ID,
        fullName: 'Chủ Nhóm',
        displayName: 'Ba',
        avatarUrl: null,
      },
    });
    await expect(s.service.getJoinPreview(' abcd2345 ')).resolves.toMatchObject(
      {
        familyId: FAMILY_ID,
        memberCount: 3,
      },
    );
    expect(s.repository.findJoinPreviewByCode).toHaveBeenCalledWith('ABCD2345');

    s.repository.findJoinPreviewByCode.mockResolvedValueOnce(null);
    await expect(s.service.getJoinPreview('NOPE2345')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('requests to join by code (status = requested) and notifies family admins', async () => {
    const s = setup();
    s.repository.joinByInviteCode.mockResolvedValue({
      outcome: 'requested',
      family,
      membership: { ...member, status: 'requested', familyLabel: 'daughter' },
      adminUserIds: [OWNER_ID],
    });
    await expect(
      s.service.joinByCode(USER_ID, {
        code: '  abcd2345 ',
        familyLabel: 'daughter',
      }),
    ).resolves.toMatchObject({
      id: FAMILY_ID,
      membership: { status: 'requested', familyLabel: 'daughter' },
    });
    expect(s.notifications.notifyFamilyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        familyId: FAMILY_ID,
        recipientUserIds: [OWNER_ID],
        type: 'family_join_request',
      }),
    );
  });

  it('lists join requests with isMinor and isSenior hints without exposing dateOfBirth', async () => {
    const s = setup();
    s.repository.listJoinRequests.mockResolvedValue({
      requests: [
        {
          ...member,
          status: 'requested',
          profile: { ...member.profile, dateOfBirth: SENIOR_DOB },
        },
      ],
      total: 1,
    });
    const res = await s.service.listJoinRequests(OWNER_ID, FAMILY_ID, {
      page: 1,
      limit: 20,
    });
    expect(res.data[0]).toMatchObject({
      id: MEMBER_ID,
      status: 'requested',
      isMinor: false,
      isSenior: true,
    });
    expect(res.data[0].profile).not.toHaveProperty('dateOfBirth');
  });

  it('approves and rejects join requests and notifies the requester', async () => {
    const s = setup();
    s.repository.approveJoinRequest.mockResolvedValue({
      outcome: 'approved',
      member: { ...member, status: 'accepted', isCareRecipient: true },
    });
    await expect(
      s.service.approveJoinRequest(OWNER_ID, FAMILY_ID, MEMBER_ID, {
        isCareRecipient: true,
      }),
    ).resolves.toMatchObject({ status: 'accepted', isCareRecipient: true });
    expect(s.notifications.notifyFamilyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserIds: [USER_ID],
        type: 'family_join_request_processed',
        metadata: expect.objectContaining({ decision: 'approved' }),
      }),
    );

    s.repository.rejectJoinRequest.mockResolvedValue({
      outcome: 'rejected',
      member: { ...member, status: 'rejected' },
    });
    await expect(
      s.service.rejectJoinRequest(OWNER_ID, FAMILY_ID, MEMBER_ID),
    ).resolves.toMatchObject({ status: 'rejected' });
  });
});

describe('FamiliesService leave and transfer ownership', () => {
  it('sends high-priority notification to all managers when a care recipient leaves', async () => {
    const s = setup();
    s.access.requireAcceptedMember.mockResolvedValue({
      id: MEMBER_ID,
      userId: USER_ID,
      isCareRecipient: true,
      profile: { dateOfBirth: SENIOR_DOB, fullName: 'Bà Nội' },
      family,
    });
    s.repository.removeMemberWithManagerInvariant.mockResolvedValue({
      outcome: 'removed',
    });

    await expect(
      s.service.leaveFamily(USER_ID, FAMILY_ID),
    ).resolves.toBeUndefined();
    expect(s.notifications.notifyFamilyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        familyId: FAMILY_ID,
        recipientUserIds: [OWNER_ID],
        type: 'care_recipient_left',
        metadata: expect.objectContaining({
          memberId: MEMBER_ID,
          priority: 'high',
        }),
      }),
    );
  });

  it('forbids a minor (< 18) from leaving', async () => {
    const s = setup();
    s.access.requireAcceptedMember.mockResolvedValue({
      id: MEMBER_ID,
      userId: USER_ID,
      isCareRecipient: false,
      profile: { dateOfBirth: MINOR_DOB },
      family,
    });
    await expect(
      s.service.leaveFamily(USER_ID, FAMILY_ID),
    ).rejects.toMatchObject({
      response: { error: { code: 'CHILD_CANNOT_LEAVE_FAMILY' } },
    });
  });

  it('transfers ownership to an adult and notifies the family', async () => {
    const s = setup();
    s.repository.transferOwnership.mockResolvedValue({
      outcome: 'transferred',
      family: { ...family, ownerUserId: USER_ID },
    });
    await expect(
      s.service.transferOwnership(OWNER_ID, FAMILY_ID, { memberId: MEMBER_ID }),
    ).resolves.toMatchObject({ ownerUserId: USER_ID });
    expect(s.notifications.notifyFamilyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        familyId: FAMILY_ID,
        type: 'family_role_changed',
      }),
    );
  });
});
