import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { ErrorCode } from '../src/common/constants/error-codes';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { FamilyAccessService } from '../src/modules/families/family-access.service';
import { FamiliesRepository } from '../src/modules/families/families.repository';
import { GeofencesRepository } from '../src/modules/geofences/geofences.repository';
import { GeofencesService } from '../src/modules/geofences/geofences.service';

const enabled = process.env.RUN_GEOFENCE_ASSIGNMENT_REGRESSION === 'true';
const runtimeDescribe = enabled ? describe : describe.skip;

runtimeDescribe('Geofence assignment runtime regression', () => {
  let prisma: PrismaClient;
  let service: GeofencesService;
  const familyIds: string[] = [];
  let fixture: {
    managerUserId: string;
    familyId: string;
    memberId: string;
    foreignMemberId: string;
    geofenceId: string;
  };

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required');

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });
    await prisma.$connect();

    const emailA = process.env.SUPABASE_TEST_USER_A_EMAIL;
    const emailB = process.env.SUPABASE_TEST_USER_B_EMAIL;
    if (!emailA || !emailB) {
      throw new Error('Supabase test user emails are required');
    }

    const [profileA, profileB] = await Promise.all([
      prisma.profile.findUnique({
        where: { email: emailA },
        select: { id: true },
      }),
      prisma.profile.findUnique({
        where: { email: emailB },
        select: { id: true },
      }),
    ]);
    if (!profileA || !profileB) {
      throw new Error('Supabase test user profiles are required');
    }

    const createFixtureFamily = async (suffix: string) => {
      const family = await prisma.$transaction(async (tx) => {
        const created = await tx.family.create({
          data: {
            familyName: `Geofence regression ${suffix}`,
            ownerUserId: profileA.id,
            status: 'active',
          },
          select: { id: true },
        });
        await tx.familyMember.create({
          data: {
            familyId: created.id,
            userId: profileA.id,
            role: 'manager',
            familyLabel: 'other',
            status: 'accepted',
            acceptedAt: new Date(),
          },
        });
        const member = await tx.familyMember.create({
          data: {
            familyId: created.id,
            userId: profileB.id,
            role: 'adult',
            familyLabel: 'other',
            status: 'accepted',
            acceptedAt: new Date(),
          },
          select: { id: true },
        });
        return { id: created.id, memberId: member.id };
      });
      familyIds.push(family.id);
      return family;
    };

    const family = await createFixtureFamily(`${Date.now()}-same`);
    const foreignFamily = await createFixtureFamily(`${Date.now()}-foreign`);

    const geofence = await prisma.geofence.create({
      data: {
        family_id: family.id,
        created_by: profileA.id,
        name: 'Regression zone',
        center_latitude: 10,
        center_longitude: 106,
        radius_meters: 100,
      },
      select: { id: true },
    });

    const applicationPrisma = prisma as unknown as PrismaService;
    const familiesRepository = new FamiliesRepository(applicationPrisma);
    const familyAccess = new FamilyAccessService(familiesRepository);
    const geofencesRepository = new GeofencesRepository(applicationPrisma);
    service = new GeofencesService(geofencesRepository, familyAccess);

    fixture = {
      managerUserId: profileA.id,
      familyId: family.id,
      memberId: family.memberId,
      foreignMemberId: foreignFamily.memberId,
      geofenceId: geofence.id,
    };
  });

  afterAll(async () => {
    for (const familyId of familyIds) {
      await prisma.family.delete({ where: { id: familyId } });
    }
    await prisma.$disconnect();
  });

  it('replaces, persists, reads, rejects foreign members, and clears assignments', async () => {
    const assigned = await service.replaceMembers(
      fixture.managerUserId,
      fixture.familyId,
      fixture.geofenceId,
      {
        members: [
          {
            memberId: fixture.memberId,
            notifyOnEnter: true,
            notifyOnExit: true,
          },
        ],
      },
    );

    expect(assigned.members).toEqual([
      expect.objectContaining({
        memberId: fixture.memberId,
        notifyOnEnter: true,
        notifyOnExit: true,
      }),
    ]);

    const persisted = await prisma.geofenceMember.findMany({
      where: { geofence_id: fixture.geofenceId },
      select: { member_id: true, notify_on_enter: true, notify_on_exit: true },
    });
    expect(persisted).toEqual([
      {
        member_id: fixture.memberId,
        notify_on_enter: true,
        notify_on_exit: true,
      },
    ]);

    const visible = await service.getOne(
      fixture.managerUserId,
      fixture.familyId,
      fixture.geofenceId,
    );
    expect(visible.members).toHaveLength(1);
    expect(visible.members[0].memberId).toBe(fixture.memberId);

    await expect(
      service.replaceMembers(
        fixture.managerUserId,
        fixture.familyId,
        fixture.geofenceId,
        {
          members: [
            {
              memberId: fixture.foreignMemberId,
              notifyOnEnter: true,
              notifyOnExit: true,
            },
          ],
        },
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GEOFENCE_MEMBER_INVALID });

    for (const status of ['pending', 'removed']) {
      await prisma.familyMember.update({
        where: { id: fixture.memberId },
        data: { status },
      });
      await expect(
        service.replaceMembers(
          fixture.managerUserId,
          fixture.familyId,
          fixture.geofenceId,
          {
            members: [
              {
                memberId: fixture.memberId,
                notifyOnEnter: true,
                notifyOnExit: true,
              },
            ],
          },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GEOFENCE_MEMBER_INVALID });
    }

    await prisma.familyMember.update({
      where: { id: fixture.memberId },
      data: { status: 'accepted' },
    });

    await service.replaceMembers(
      fixture.managerUserId,
      fixture.familyId,
      fixture.geofenceId,
      { members: [] },
    );
    expect(
      await prisma.geofenceMember.count({
        where: { geofence_id: fixture.geofenceId },
      }),
    ).toBe(0);
  });
});
