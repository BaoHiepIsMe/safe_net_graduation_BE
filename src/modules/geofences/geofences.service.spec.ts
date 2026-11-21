import { Prisma } from '../../generated/prisma/client';
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/app.error';
import { FamilyAccessService } from '../families/family-access.service';
import { GeofencesRepository } from './geofences.repository';
import { GeofencesService } from './geofences.service';

const USER = '11111111-1111-4111-8111-111111111111';
const FAMILY = '22222222-2222-4222-8222-222222222222';
const ZONE = '33333333-3333-4333-8333-333333333333';
const MEMBER = '44444444-4444-4444-8444-444444444444';
const row = {
  id: ZONE,
  family_id: FAMILY,
  name: 'Home',
  address: null,
  center_latitude: new Prisma.Decimal(10.7),
  center_longitude: new Prisma.Decimal(106.6),
  radius_meters: 100,
  is_active: true,
  created_at: new Date(),
  updated_at: new Date(),
  GeofenceMember: [],
};

describe('GeofencesService', () => {
  function setup() {
    const repository = {
      createWithMembers: jest.fn(),
      list: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
      replaceMembers: jest.fn(),
      listEvents: jest.fn(),
    };
    const access = {
      requireCareManager: jest.fn().mockResolvedValue({}),
      requireAcceptedMember: jest.fn().mockResolvedValue({}),
      canManage: jest.fn().mockResolvedValue(true),
    };
    return {
      repository,
      access,
      service: new GeofencesService(
        repository as unknown as GeofencesRepository,
        access as unknown as FamilyAccessService,
      ),
    };
  }

  it('requires manager permission and derives creator from the actor', async () => {
    const { service, repository, access } = setup();
    repository.createWithMembers.mockResolvedValue({
      outcome: 'created',
      geofence: row,
    });
    await service.create(USER, FAMILY, {
      name: 'Home',
      centerLatitude: 10.7,
      centerLongitude: 106.6,
      radiusMeters: 100,
      members: [],
    });
    expect(access.requireCareManager).toHaveBeenCalledWith(USER, FAMILY);
    expect(repository.createWithMembers).toHaveBeenCalledWith(
      FAMILY,
      USER,
      expect.any(Object),
    );
  });

  it('denies non-manager mutations before repository access', async () => {
    const { service, repository, access } = setup();
    access.requireCareManager.mockRejectedValue(new ForbiddenError());
    await expect(
      service.update(USER, FAMILY, ZONE, { name: 'School' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('requires accepted active family access for reads and event history', async () => {
    const { service, repository, access } = setup();
    repository.list.mockResolvedValue({ rows: [], total: 0 });
    repository.listEvents.mockResolvedValue([]);
    await service.list(USER, FAMILY, { page: 1, limit: 20 });
    await service.listEvents(USER, FAMILY, { limit: 20 });
    expect(access.requireAcceptedMember).toHaveBeenCalledTimes(2);
  });

  it('scopes geofence reads to both family and geofence IDs', async () => {
    const { service, repository } = setup();
    repository.findOne.mockResolvedValue(row);
    await service.getOne(USER, FAMILY, ZONE);
    expect(repository.findOne).toHaveBeenCalledWith(FAMILY, ZONE);
  });

  it('hides foreign or missing geofences', async () => {
    const { service, repository } = setup();
    repository.findOne.mockResolvedValue(null);
    await expect(service.getOne(USER, FAMILY, ZONE)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('rejects pending, rejected, removed, or foreign assignment IDs atomically', async () => {
    const { service, repository } = setup();
    repository.replaceMembers.mockResolvedValue({
      outcome: 'invalid_members',
      invalidMemberIds: [MEMBER],
    });
    await expect(
      service.replaceMembers(USER, FAMILY, ZONE, {
        members: [
          { memberId: MEMBER, notifyOnEnter: true, notifyOnExit: true },
        ],
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('deactivates instead of physically deleting history', async () => {
    const { service, repository } = setup();
    repository.deactivate.mockResolvedValue({ count: 1 });
    await service.deactivate(USER, FAMILY, ZONE);
    expect(repository.deactivate).toHaveBeenCalledWith(FAMILY, ZONE);
  });

  it('returns safe geofence DTOs without creator or internal state', async () => {
    const { service, repository } = setup();
    repository.findOne.mockResolvedValue({ ...row, created_by: USER });
    const result = await service.getOne(USER, FAMILY, ZONE);
    expect(result).not.toHaveProperty('created_by');
    expect(result).not.toHaveProperty('GeofenceState');
  });

  it('rejects assigning a member the care manager cannot manage', async () => {
    const { service, repository, access } = setup();
    access.canManage.mockResolvedValue(false);
    await expect(
      service.create(USER, FAMILY, {
        name: 'Home',
        centerLatitude: 10.7,
        centerLongitude: 106.6,
        radiusMeters: 100,
        members: [
          { memberId: MEMBER, notifyOnEnter: true, notifyOnExit: true },
        ],
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(repository.createWithMembers).not.toHaveBeenCalled();
  });

  it('limits a hired non-owner caregiver to geofences in their care scope', async () => {
    const { service, repository, access } = setup();
    const nurse = {
      id: 'nurse-member',
      userId: USER,
      canManageCare: true,
      isHired: true,
      family: { ownerUserId: '99999999-9999-4999-8999-999999999999' },
      careScopes: [{ targetMemberId: MEMBER }],
    };
    access.requireAcceptedMember.mockResolvedValue(nurse);
    access.requireCareManager.mockResolvedValue(nurse);
    const inScopeZone = {
      ...row,
      id: ZONE,
      GeofenceMember: [
        {
          member_id: MEMBER,
          notify_on_enter: true,
          notify_on_exit: true,
          FamilyMember: {
            userId: USER,
            displayName: 'Child',
            profile: { fullName: 'Child', avatarUrl: null },
          },
        },
      ],
    };
    const outOfScopeZone = {
      ...row,
      id: '55555555-5555-4555-8555-555555555555',
      GeofenceMember: [
        {
          ...inScopeZone.GeofenceMember[0],
          member_id: '66666666-6666-4666-8666-666666666666',
        },
      ],
    };

    // The scope is applied in the query, so pagination totals stay correct.
    repository.list.mockResolvedValue({ rows: [inScopeZone], total: 1 });
    const listResult = await service.list(USER, FAMILY, { page: 1, limit: 20 });
    expect(repository.list).toHaveBeenCalledWith(
      FAMILY,
      { page: 1, limit: 20 },
      [MEMBER],
    );
    expect(listResult.pagination).toMatchObject({ total: 1, totalPages: 1 });

    repository.findOne.mockResolvedValue(outOfScopeZone);
    await expect(
      service.getOne(USER, FAMILY, outOfScopeZone.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.update(USER, FAMILY, outOfScopeZone.id, { name: 'Trường' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.deactivate(USER, FAMILY, outOfScopeZone.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.deactivate).not.toHaveBeenCalled();
  });
});
