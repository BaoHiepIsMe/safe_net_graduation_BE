import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { LocationsRepository } from './locations.repository';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const DEVICE_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';
const FAMILY_ID = '55555555-5555-4555-8555-555555555555';
const MEMBER_ID = '66666666-6666-4666-8666-666666666666';
const recordedAt = new Date('2026-08-24T04:00:00.000Z');
const dto = { latitude: 10.7, longitude: 106.6, recordedAt };
const history = {
  id: LOCATION_ID,
  latitude: new Prisma.Decimal(10.7),
  longitude: new Prisma.Decimal(106.6),
  accuracy: null,
  speed: null,
  heading: null,
  batteryLevel: null,
  recordedAt,
  createdAt: new Date(),
};

function setupTransaction(overrides: Record<string, unknown> = {}) {
  const tx = {
    device: {
      findFirst: jest.fn().mockResolvedValue({ id: DEVICE_ID, isActive: true }),
      update: jest.fn().mockResolvedValue({ id: DEVICE_ID }),
    },
    location: { create: jest.fn().mockResolvedValue(history) },
    familyMember: { findMany: jest.fn().mockResolvedValue([]) },
    userSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    locationShareViewer: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([{ user_id: USER_A }]),
    ...overrides,
  };
  const prisma = {
    $transaction: jest.fn((callback) => callback(tx)),
  } as unknown as PrismaService;
  return { tx, prisma, repository: new LocationsRepository(prisma) };
}

describe('LocationsRepository', () => {
  it('verifies actor ownership and active state inside the write transaction', async () => {
    const { tx, repository } = setupTransaction();
    await expect(
      repository.ingest(USER_A, DEVICE_ID, dto),
    ).resolves.toMatchObject({ outcome: 'stored', currentUpdated: true });
    expect(tx.device.findFirst).toHaveBeenCalledWith({
      where: { id: DEVICE_ID, userId: USER_A },
      select: { id: true, isActive: true },
    });
    expect(tx.location.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_A,
          deviceId: DEVICE_ID,
          recordedAt,
        }),
      }),
    );
  });

  it('denies foreign devices without writing history', async () => {
    const { tx, repository } = setupTransaction();
    tx.device.findFirst.mockResolvedValue(null);
    await expect(repository.ingest(USER_B, DEVICE_ID, dto)).resolves.toEqual({
      outcome: 'not_found',
    });
    expect(tx.location.create).not.toHaveBeenCalled();
  });

  it('denies inactive devices without reactivation', async () => {
    const { tx, repository } = setupTransaction();
    tx.device.findFirst.mockResolvedValue({ id: DEVICE_ID, isActive: false });
    await expect(repository.ingest(USER_A, DEVICE_ID, dto)).resolves.toEqual({
      outcome: 'inactive',
    });
    expect(tx.device.update).not.toHaveBeenCalled();
  });

  it('uses one atomic conditional upsert to prevent stale/concurrent regression', async () => {
    const { tx, repository } = setupTransaction();
    await repository.ingest(USER_A, DEVICE_ID, dto);
    const sql = tx.$queryRaw.mock.calls[0][0] as { strings: string[] };
    const text = sql.strings.join(' ');
    expect(text).toContain('ON CONFLICT ("user_id") DO UPDATE');
    expect(text).toContain(
      'EXCLUDED."recorded_at" > "current_locations"."recorded_at"',
    );
    expect(text).toContain(
      'EXCLUDED."location_id" > "current_locations"."location_id"',
    );
  });

  it('stores stale history but reports that current state was not replaced', async () => {
    const { tx, repository } = setupTransaction();
    tx.$queryRaw.mockResolvedValue([]);
    await expect(
      repository.ingest(USER_A, DEVICE_ID, dto),
    ).resolves.toMatchObject({ outcome: 'stored', currentUpdated: false });
    expect(tx.location.create).toHaveBeenCalledTimes(1);
  });

  it('fans out to every accepted member of actively shared families of the sender', async () => {
    const { tx, repository } = setupTransaction();
    tx.familyMember.findMany
      .mockResolvedValueOnce([
        { familyId: '55555555-5555-4555-8555-555555555555' },
      ])
      .mockResolvedValueOnce([{ userId: USER_B }]);
    await expect(
      repository.ingest(USER_A, DEVICE_ID, dto),
    ).resolves.toMatchObject({ recipientUserIds: [USER_B] });
    expect(tx.familyMember.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER_A,
          status: 'accepted',
          locationSharingEnabled: true,
          family: { status: 'active' },
          profile: { UserSetting: { locationSharingEnabled: true } },
        }),
      }),
    );
    // D7: recipients follow the REST viewing rule, so their own sharing flag is not required.
    const recipientWhere = tx.familyMember.findMany.mock.calls[1][0].where;
    expect(recipientWhere).toMatchObject({
      status: 'accepted',
      family: { status: 'active' },
    });
    expect(recipientWhere).not.toHaveProperty('locationSharingEnabled');
  });

  it('returns no family recipients when owner global/family sharing finds no relationship', async () => {
    const { tx, repository } = setupTransaction();
    tx.familyMember.findMany.mockResolvedValueOnce([]);
    await expect(
      repository.ingest(USER_A, DEVICE_ID, dto),
    ).resolves.toMatchObject({ recipientUserIds: [] });
    expect(tx.familyMember.findMany).toHaveBeenCalledTimes(1);
  });

  it('rejects the complete transaction when current projection persistence fails', async () => {
    const { tx, repository } = setupTransaction();
    tx.$queryRaw.mockRejectedValue(new Error('projection failed'));
    await expect(repository.ingest(USER_A, DEVICE_ID, dto)).rejects.toThrow(
      'projection failed',
    );
    expect(tx.location.create).toHaveBeenCalledTimes(1);
  });

  it('uses deterministic descending cursor history ordering scoped to the owner', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { location: { findMany } } as unknown as PrismaService;
    await new LocationsRepository(prisma).listHistory(
      USER_A,
      { limit: 20 },
      { recordedAt, id: LOCATION_ID },
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_A }),
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
        take: 21,
      }),
    );
    const where = findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('recordedAt');
  });

  it('filters history to [from, to) and combines it with the cursor', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { location: { findMany } } as unknown as PrismaService;
    const from = new Date('2026-08-24T00:00:00.000Z');
    const to = new Date('2026-08-25T00:00:00.000Z');
    await new LocationsRepository(prisma).listHistory(
      USER_A,
      { limit: 20 },
      { recordedAt, id: LOCATION_ID },
      { from, to },
    );
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      userId: USER_A,
      recordedAt: { gte: from, lt: to },
      OR: expect.any(Array),
    });
    await new LocationsRepository(prisma).listHistory(
      USER_A,
      { limit: 20 },
      undefined,
      { from },
    );
    expect(findMany.mock.calls[1][0].where.recordedAt).toEqual({ gte: from });
  });

  it('finds the history target only for accepted members of active families', async () => {
    const findFirst = jest.fn();
    const prisma = { familyMember: { findFirst } } as unknown as PrismaService;
    const repository = new LocationsRepository(prisma);
    findFirst.mockResolvedValueOnce({
      userId: USER_B,
      locationSharingEnabled: true,
      profile: { UserSetting: { locationSharingEnabled: true } },
    });
    await expect(
      repository.findHistoryTarget(FAMILY_ID, MEMBER_ID, USER_A),
    ).resolves.toEqual({ userId: USER_B, sharing: true });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: MEMBER_ID,
          familyId: FAMILY_ID,
          status: 'accepted',
          family: { status: 'active' },
        },
      }),
    );
    findFirst.mockResolvedValueOnce({
      userId: USER_B,
      locationSharingEnabled: true,
      profile: { UserSetting: { locationSharingEnabled: false } },
    });
    await expect(
      repository.findHistoryTarget(FAMILY_ID, MEMBER_ID, USER_A),
    ).resolves.toEqual({ userId: USER_B, sharing: false });
    findFirst.mockResolvedValueOnce({
      userId: USER_B,
      locationSharingEnabled: false,
      profile: { UserSetting: { locationSharingEnabled: true } },
    });
    await expect(
      repository.findHistoryTarget(FAMILY_ID, MEMBER_ID, USER_A),
    ).resolves.toEqual({ userId: USER_B, sharing: false });
    findFirst.mockResolvedValueOnce(null);
    await expect(
      repository.findHistoryTarget(FAMILY_ID, MEMBER_ID, USER_A),
    ).resolves.toBeNull();
  });
});
