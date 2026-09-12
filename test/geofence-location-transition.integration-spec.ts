import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { GeofencesRepository } from '../src/modules/geofences/geofences.repository';

const enabled = process.env.RUN_GEOFENCE_TRANSITION_REGRESSION === 'true';
const runtimeDescribe = enabled ? describe : describe.skip;
type RegressionLocation = {
  id: string;
  userId: string;
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
  recordedAt: Date;
};

runtimeDescribe('Geofence location transition PostgreSQL regression', () => {
  let prisma: PrismaClient | undefined;
  let repository: GeofencesRepository;
  let fixture: {
    familyId: string;
    memberId: string;
    geofenceId: string;
    deviceId: string;
    locationIds: string[];
  };

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    const email = process.env.SUPABASE_TEST_USER_A_EMAIL;
    if (!databaseUrl || !email) {
      throw new Error('Database URL and Supabase test user are required');
    }

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });
    await prisma.$connect();

    const profile = await prisma.profile.findUnique({
      where: { email },
      select: { id: true },
    });
    const device = profile
      ? await prisma.device.findFirst({
          where: { userId: profile.id, isActive: true },
          select: { id: true },
        })
      : null;
    if (!profile || !device) {
      throw new Error('A profile with an active device is required');
    }

    const family = await prisma.$transaction(async (tx) => {
      const createdFamily = await tx.family.create({
        data: {
          familyName: `Geofence transition regression ${Date.now()}`,
          ownerUserId: profile.id,
          status: 'active',
        },
        select: { id: true },
      });
      const member = await tx.familyMember.create({
        data: {
          familyId: createdFamily.id,
          userId: profile.id,
          role: 'manager',
          familyLabel: 'other',
          status: 'accepted',
          acceptedAt: new Date(),
        },
        select: { id: true },
      });
      return { familyId: createdFamily.id, memberId: member.id };
    });

    const geofence = await prisma.geofence.create({
      data: {
        family_id: family.familyId,
        created_by: profile.id,
        name: 'Transition regression zone',
        center_latitude: 10,
        center_longitude: 106,
        radius_meters: 100,
      },
      select: { id: true },
    });
    await prisma.geofenceMember.create({
      data: {
        family_id: family.familyId,
        geofence_id: geofence.id,
        member_id: family.memberId,
        notify_on_enter: true,
        notify_on_exit: true,
      },
    });

    repository = new GeofencesRepository(prisma as unknown as PrismaService);
    fixture = {
      familyId: family.familyId,
      memberId: family.memberId,
      geofenceId: geofence.id,
      deviceId: device.id,
      locationIds: [],
    };
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      if (fixture?.locationIds.length) {
        await prisma.location.deleteMany({
          where: { id: { in: fixture.locationIds } },
        });
      }
      if (fixture?.familyId) {
        await prisma.family.delete({ where: { id: fixture.familyId } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it('persists initial state, exit, and enter through real PostgreSQL triggers', async () => {
    if (!prisma) throw new Error('Prisma fixture was not initialized');

    const points = [
      { latitude: 10.0001, longitude: 106.0001 },
      { latitude: 10.0025, longitude: 106.0025 },
      { latitude: 10.0002, longitude: 106.0002 },
    ];
    const baseTime = Date.now();
    const locations: RegressionLocation[] = [];
    for (const [index, point] of points.entries()) {
      const location = await prisma.location.create({
        data: {
          userId: (
            await prisma.familyMember.findUniqueOrThrow({
              where: { id: fixture.memberId },
              select: { userId: true },
            })
          ).userId,
          memberId: fixture.memberId,
          deviceId: fixture.deviceId,
          latitude: point.latitude,
          longitude: point.longitude,
          recordedAt: new Date(baseTime + index * 1000),
        },
        select: {
          id: true,
          userId: true,
          latitude: true,
          longitude: true,
          recordedAt: true,
        },
      });
      fixture.locationIds.push(location.id);
      locations.push(location);
    }

    const evaluate = (location: (typeof locations)[number]) =>
      repository.evaluateCommittedLocation({
        id: location.id,
        userId: location.userId,
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        recordedAt: location.recordedAt,
      });

    expect(await evaluate(locations[0])).toEqual([]);
    const initialState = await prisma.geofenceState.findUnique({
      where: {
        geofence_id_member_id: {
          geofence_id: fixture.geofenceId,
          member_id: fixture.memberId,
        },
      },
      select: { is_inside: true, last_location_id: true },
    });
    expect(initialState).toEqual({
      is_inside: true,
      last_location_id: locations[0].id,
    });
    expect(
      await prisma.geofenceEvent.count({
        where: {
          geofence_id: fixture.geofenceId,
          member_id: fixture.memberId,
        },
      }),
    ).toBe(0);

    const exit = await evaluate(locations[1]);
    expect(exit).toHaveLength(1);
    expect(exit[0].eventType).toBe('exit');

    const enter = await evaluate(locations[2]);
    expect(enter).toHaveLength(1);
    expect(enter[0].eventType).toBe('enter');

    expect(
      await prisma.geofenceEvent.findMany({
        where: {
          geofence_id: fixture.geofenceId,
          member_id: fixture.memberId,
        },
        select: { event_type: true, location_id: true },
        orderBy: { detected_at: 'asc' },
      }),
    ).toEqual([
      { event_type: 'exit', location_id: locations[1].id },
      { event_type: 'enter', location_id: locations[2].id },
    ]);
  });
});
