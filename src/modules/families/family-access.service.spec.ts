import { ForbiddenError } from '../../common/errors/app.error';
import { FamiliesRepository } from './families.repository';
import { FamilyAccessService } from './family-access.service';

const OWNER_USER_ID = '11111111-1111-4111-8111-111111111111';
const MANAGER_USER_ID = '22222222-2222-4222-8222-222222222222';
const HIRED_USER_ID = '33333333-3333-4333-8333-333333333333';
const MEMBER_USER_ID = '44444444-4444-4444-8444-444444444444';
const FAMILY_ID = '55555555-5555-4555-8555-555555555555';
const TARGET_MEMBER_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_TARGET_MEMBER_ID = '77777777-7777-4777-8777-777777777777';

const activeFamily = {
  id: FAMILY_ID,
  familyName: 'Gia đình A',
  ownerUserId: OWNER_USER_ID,
  avatarUrl: null,
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeTarget(overrides: Record<string, any> = {}) {
  return {
    id: TARGET_MEMBER_ID,
    userId: MEMBER_USER_ID,
    familyId: FAMILY_ID,
    familyLabel: 'grandmother',
    displayName: 'Bà nội',
    status: 'accepted',
    canManageCare: false,
    isCareRecipient: true,
    isHired: false,
    locationSharingEnabled: true,
    careScopes: [],
    profile: {
      id: MEMBER_USER_ID,
      fullName: 'Bà Nội',
      avatarUrl: null,
      dateOfBirth: new Date('1955-01-01T00:00:00.000Z'),
      gender: 'female',
    },
    family: activeFamily,
    ...overrides,
  };
}

function makeActor(overrides: Record<string, any> = {}) {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    userId: MANAGER_USER_ID,
    familyId: FAMILY_ID,
    familyLabel: 'father',
    displayName: 'Ba',
    status: 'accepted',
    canManageCare: true,
    isCareRecipient: false,
    isHired: false,
    locationSharingEnabled: true,
    careScopes: [],
    profile: {
      id: MANAGER_USER_ID,
      fullName: 'Ba',
      avatarUrl: null,
      dateOfBirth: new Date('1985-05-10T00:00:00.000Z'),
      gender: 'male',
    },
    family: activeFamily,
    ...overrides,
  };
}

describe('FamilyAccessService', () => {
  it('allows an accepted member', async () => {
    const repository = {
      findAccessMembership: jest.fn().mockResolvedValue(
        makeActor({
          canManageCare: false,
        }),
      ),
    } as unknown as FamiliesRepository;
    await expect(
      new FamilyAccessService(repository).requireAcceptedMember(
        MANAGER_USER_ID,
        FAMILY_ID,
      ),
    ).resolves.toMatchObject({ userId: MANAGER_USER_ID });
  });

  it.each(['foreign', 'pending', 'requested', 'rejected', 'removed'])(
    'denies %s users without an accepted access row',
    async () => {
      const repository = {
        findAccessMembership: jest.fn().mockResolvedValue(null),
      } as unknown as FamiliesRepository;
      await expect(
        new FamilyAccessService(repository).requireAcceptedMember(
          MANAGER_USER_ID,
          FAMILY_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    },
  );

  it('requireCareManager allows both regular and hired care managers and rejects non-managers', async () => {
    const findAccessMembership = jest
      .fn()
      .mockResolvedValueOnce(makeActor({ canManageCare: true, isHired: false }))
      .mockResolvedValueOnce(makeActor({ canManageCare: true, isHired: true }))
      .mockResolvedValueOnce(
        makeActor({ canManageCare: false, isHired: false }),
      );
    const service = new FamilyAccessService({
      findAccessMembership,
    } as unknown as FamiliesRepository);

    await expect(
      service.requireCareManager(MANAGER_USER_ID, FAMILY_ID),
    ).resolves.toMatchObject({ canManageCare: true, isHired: false });
    await expect(
      service.requireCareManager(HIRED_USER_ID, FAMILY_ID),
    ).resolves.toMatchObject({ canManageCare: true, isHired: true });
    await expect(
      service.requireCareManager(MEMBER_USER_ID, FAMILY_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('requireFamilyAdmin allows non-hired care manager or owner (even if owner is hired), and denies non-owner hired caregiver', async () => {
    const findAccessMembership = jest
      .fn()
      .mockResolvedValueOnce(makeActor({ canManageCare: true, isHired: false }))
      .mockResolvedValueOnce(
        makeActor({
          userId: HIRED_USER_ID,
          canManageCare: true,
          isHired: true,
          family: { ...activeFamily, ownerUserId: HIRED_USER_ID },
        }),
      )
      .mockResolvedValueOnce(
        makeActor({
          userId: HIRED_USER_ID,
          canManageCare: true,
          isHired: true,
          family: activeFamily,
        }),
      );
    const service = new FamilyAccessService({
      findAccessMembership,
    } as unknown as FamiliesRepository);

    await expect(
      service.requireFamilyAdmin(MANAGER_USER_ID, FAMILY_ID),
    ).resolves.toMatchObject({ canManageCare: true });
    await expect(
      service.requireFamilyAdmin(HIRED_USER_ID, FAMILY_ID),
    ).resolves.toMatchObject({ userId: HIRED_USER_ID, isHired: true });
    await expect(
      service.requireFamilyAdmin(HIRED_USER_ID, FAMILY_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('requireOwner checks families.owner_user_id', async () => {
    const findAccessMembership = jest
      .fn()
      .mockResolvedValueOnce(makeActor({ userId: OWNER_USER_ID }))
      .mockResolvedValueOnce(makeActor({ userId: MANAGER_USER_ID }));
    const service = new FamilyAccessService({
      findAccessMembership,
    } as unknown as FamiliesRepository);

    await expect(
      service.requireOwner(OWNER_USER_ID, FAMILY_ID),
    ).resolves.toMatchObject({ userId: OWNER_USER_ID });
    await expect(
      service.requireOwner(MANAGER_USER_ID, FAMILY_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  describe('canManage / requireCanManage / listManagersFor', () => {
    it('denies when actor is not a care manager (can_manage_care = false)', async () => {
      const service = new FamilyAccessService({
        findMemberForAccess: jest.fn().mockResolvedValue(makeTarget()),
        findAccessMembership: jest
          .fn()
          .mockResolvedValue(makeActor({ canManageCare: false })),
      } as unknown as FamiliesRepository);

      await expect(
        service.canManage(MANAGER_USER_ID, TARGET_MEMBER_ID),
      ).resolves.toBe(false);
      await expect(
        service.requireCanManage(MANAGER_USER_ID, TARGET_MEMBER_ID),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('denies self-targeting even when actor is both care manager and care recipient', async () => {
      const service = new FamilyAccessService({
        findMemberForAccess: jest
          .fn()
          .mockResolvedValue(
            makeTarget({ userId: MANAGER_USER_ID, isCareRecipient: true }),
          ),
        findAccessMembership: jest
          .fn()
          .mockResolvedValue(
            makeActor({ userId: MANAGER_USER_ID, canManageCare: true }),
          ),
      } as unknown as FamiliesRepository);

      await expect(
        service.canManage(MANAGER_USER_ID, TARGET_MEMBER_ID),
      ).resolves.toBe(false);
    });

    it('denies when target is not a care recipient (adult >= 18 with isCareRecipient = false)', async () => {
      const service = new FamilyAccessService({
        findMemberForAccess: jest.fn().mockResolvedValue(
          makeTarget({
            isCareRecipient: false,
            profile: {
              id: MEMBER_USER_ID,
              fullName: 'Người lớn',
              avatarUrl: null,
              dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
              gender: 'male',
            },
          }),
        ),
        findAccessMembership: jest.fn().mockResolvedValue(makeActor()),
      } as unknown as FamiliesRepository);

      await expect(
        service.canManage(MANAGER_USER_ID, TARGET_MEMBER_ID),
      ).resolves.toBe(false);
    });

    it('allows when target is a minor (< 18 in Asia/Ho_Chi_Minh) even with isCareRecipient = false', async () => {
      const service = new FamilyAccessService({
        findMemberForAccess: jest.fn().mockResolvedValue(
          makeTarget({
            isCareRecipient: false,
            profile: {
              id: MEMBER_USER_ID,
              fullName: 'Bé An',
              avatarUrl: null,
              dateOfBirth: new Date('2015-06-01T00:00:00.000Z'),
              gender: 'male',
            },
          }),
        ),
        findAccessMembership: jest.fn().mockResolvedValue(makeActor()),
      } as unknown as FamiliesRepository);

      await expect(
        service.canManage(MANAGER_USER_ID, TARGET_MEMBER_ID),
      ).resolves.toBe(true);
    });

    it('treats missing dateOfBirth as not a minor (denied if isCareRecipient = false, allowed if isCareRecipient = true)', async () => {
      const findMemberForAccess = jest
        .fn()
        .mockResolvedValueOnce(
          makeTarget({
            isCareRecipient: false,
            profile: {
              id: MEMBER_USER_ID,
              fullName: 'Chưa có ngày sinh',
              avatarUrl: null,
              dateOfBirth: null,
              gender: null,
            },
          }),
        )
        .mockResolvedValueOnce(
          makeTarget({
            isCareRecipient: true,
            profile: {
              id: MEMBER_USER_ID,
              fullName: 'Trẻ cũ thiếu ngày sinh được backfill',
              avatarUrl: null,
              dateOfBirth: null,
              gender: null,
            },
          }),
        );
      const service = new FamilyAccessService({
        findMemberForAccess,
        findAccessMembership: jest.fn().mockResolvedValue(makeActor()),
      } as unknown as FamiliesRepository);

      await expect(
        service.canManage(MANAGER_USER_ID, TARGET_MEMBER_ID),
      ).resolves.toBe(false);
      await expect(
        service.canManage(MANAGER_USER_ID, TARGET_MEMBER_ID),
      ).resolves.toBe(true);
    });

    it('enforces care scope for hired caregiver (outside scope denied, inside scope allowed, hired owner allowed without scope)', async () => {
      const findAccessMembership = jest
        .fn()
        // Hired caregiver outside scope
        .mockResolvedValueOnce(
          makeActor({
            userId: HIRED_USER_ID,
            isHired: true,
            careScopes: [{ targetMemberId: OTHER_TARGET_MEMBER_ID }],
          }),
        )
        // Hired caregiver inside scope
        .mockResolvedValueOnce(
          makeActor({
            userId: HIRED_USER_ID,
            isHired: true,
            careScopes: [{ targetMemberId: TARGET_MEMBER_ID }],
          }),
        )
        // Hired caregiver who is the family owner (bà đơn thân)
        .mockResolvedValueOnce(
          makeActor({
            userId: HIRED_USER_ID,
            isHired: true,
            careScopes: [],
            family: { ...activeFamily, ownerUserId: HIRED_USER_ID },
          }),
        );
      const findMemberForAccess = jest
        .fn()
        .mockResolvedValueOnce(makeTarget())
        .mockResolvedValueOnce(makeTarget())
        .mockResolvedValueOnce(
          makeTarget({
            family: { ...activeFamily, ownerUserId: HIRED_USER_ID },
          }),
        );

      const service = new FamilyAccessService({
        findMemberForAccess,
        findAccessMembership,
      } as unknown as FamiliesRepository);

      await expect(
        service.canManage(HIRED_USER_ID, TARGET_MEMBER_ID),
      ).resolves.toBe(false);
      await expect(
        service.canManage(HIRED_USER_ID, TARGET_MEMBER_ID),
      ).resolves.toBe(true);
      await expect(
        service.canManage(HIRED_USER_ID, TARGET_MEMBER_ID),
      ).resolves.toBe(true);
    });

    it.each(['pending', 'requested', 'rejected', 'removed'])(
      'denies when target or actor membership status is %s',
      async (nonAcceptedStatus) => {
        const serviceTargetNotAccepted = new FamilyAccessService({
          findMemberForAccess: jest
            .fn()
            .mockResolvedValue(makeTarget({ status: nonAcceptedStatus })),
          findAccessMembership: jest.fn().mockResolvedValue(makeActor()),
        } as unknown as FamiliesRepository);

        await expect(
          serviceTargetNotAccepted.canManage(MANAGER_USER_ID, TARGET_MEMBER_ID),
        ).resolves.toBe(false);

        const serviceActorNotAccepted = new FamilyAccessService({
          findMemberForAccess: jest.fn().mockResolvedValue(makeTarget()),
          findAccessMembership: jest
            .fn()
            .mockResolvedValue(makeActor({ status: nonAcceptedStatus })),
        } as unknown as FamiliesRepository);

        await expect(
          serviceActorNotAccepted.canManage(MANAGER_USER_ID, TARGET_MEMBER_ID),
        ).resolves.toBe(false);
      },
    );

    it('denies when family is archived', async () => {
      const archivedFamily = { ...activeFamily, status: 'archived' };
      const service = new FamilyAccessService({
        findMemberForAccess: jest
          .fn()
          .mockResolvedValue(makeTarget({ family: archivedFamily })),
        findAccessMembership: jest
          .fn()
          .mockResolvedValue(makeActor({ family: archivedFamily })),
      } as unknown as FamiliesRepository);

      await expect(
        service.canManage(MANAGER_USER_ID, TARGET_MEMBER_ID),
      ).resolves.toBe(false);
    });

    it('listManagersFor returns only managers who satisfy canManage for the target', async () => {
      const service = new FamilyAccessService({
        findMemberForAccess: jest.fn().mockResolvedValue(makeTarget()),
        findAcceptedCareManagersInFamily: jest.fn().mockResolvedValue([
          // Owner (full manager)
          makeActor({ id: 'm-owner', userId: OWNER_USER_ID, isHired: false }),
          // Target themselves (even if they also have canManageCare = true) -> excluded
          makeActor({ id: 'm-self', userId: MEMBER_USER_ID, isHired: false }),
          // Hired caregiver in scope -> included
          makeActor({
            id: 'm-hired-in',
            userId: HIRED_USER_ID,
            isHired: true,
            careScopes: [{ targetMemberId: TARGET_MEMBER_ID }],
          }),
          // Hired caregiver out of scope -> excluded
          makeActor({
            id: 'm-hired-out',
            userId: '99999999-9999-4999-8999-999999999999',
            isHired: true,
            careScopes: [{ targetMemberId: OTHER_TARGET_MEMBER_ID }],
          }),
        ]),
      } as unknown as FamiliesRepository);

      const managers = await service.listManagersFor(TARGET_MEMBER_ID);
      expect(managers.map((m) => m.id)).toEqual(['m-owner', 'm-hired-in']);
    });
  });
});
