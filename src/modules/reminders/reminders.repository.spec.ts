import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RemindersRepository } from './reminders.repository';

const USER = '11111111-1111-4111-8111-111111111111';
const FAMILY = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const REMINDER = '44444444-4444-4444-8444-444444444444';
const occurrence = new Date('2030-01-01T08:00:00Z');

const schedule = {
  scheduleType: 'once' as const,
  timezone: 'UTC',
  startAt: occurrence,
  endAt: occurrence,
  scheduleRule: null,
  nextOccurrenceAt: occurrence,
};

describe('RemindersRepository', () => {
  const setup = () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      familyMember: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'manager-member',
          userId: USER,
          canManageCare: true,
          isHired: false,
          careScopes: [],
          family: { ownerUserId: USER },
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: MEMBER,
            userId: 'child-user',
            isCareRecipient: false,
            profile: { dateOfBirth: new Date('2016-01-01T00:00:00Z') },
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      reminder: {
        create: jest.fn().mockResolvedValue({ id: REMINDER }),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: REMINDER, familyId: FAMILY }),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: REMINDER }),
      },
      reminderTarget: {
        findMany: jest.fn().mockResolvedValue([{ memberId: MEMBER }]),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      reminderLog: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ id: MEMBER }]),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
      reminder: { findMany: jest.fn(), findFirst: jest.fn() },
      reminderLog: { findMany: jest.fn(), updateMany: jest.fn() },
    };
    return {
      tx,
      prisma,
      repository: new RemindersRepository(prisma as unknown as PrismaService),
    };
  };

  const dto = {
    familyId: FAMILY,
    title: 'Reminder',
    schedule: {
      type: 'once' as const,
      occurrenceAt: occurrence.toISOString(),
      timezone: 'UTC',
    },
    targetMemberIds: [MEMBER],
  };

  it('creates reminder and validated targets in one transaction', async () => {
    const { prisma, tx, repository } = setup();
    await expect(repository.create(USER, dto, schedule)).resolves.toMatchObject(
      {
        outcome: 'created',
      },
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.reminder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creatorUserId: USER,
          targets: { create: [{ memberId: MEMBER }] },
        }),
      }),
    );
  });

  it('stores a one-time rule as SQL NULL, not JSON null (DB check constraint)', async () => {
    const { tx, repository } = setup();
    await repository.create(USER, dto, schedule);
    const data = tx.reminder.create.mock.calls[0][0].data;
    expect(data.scheduleRule).toBe(Prisma.DbNull);
  });

  it('rejects non-manager creation before writing', async () => {
    const { tx, repository } = setup();
    tx.familyMember.findFirst.mockResolvedValue(null);
    await expect(repository.create(USER, dto, schedule)).resolves.toEqual({
      outcome: 'forbidden',
    });
    expect(tx.reminder.create).not.toHaveBeenCalled();
  });

  it('rejects foreign or pending targets before writing', async () => {
    const { tx, repository } = setup();
    tx.familyMember.findMany.mockResolvedValue([]);
    await expect(repository.create(USER, dto, schedule)).resolves.toEqual({
      outcome: 'invalid_target',
    });
    expect(tx.reminder.create).not.toHaveBeenCalled();
  });

  it('rejects targets that the care manager cannot manage (self, non-care-recipient, or out of hired scope)', async () => {
    const { tx, repository } = setup();
    tx.familyMember.findMany.mockResolvedValueOnce([
      {
        id: MEMBER,
        userId: USER,
        isCareRecipient: true,
        profile: { dateOfBirth: new Date('1980-01-01') },
      },
    ]);
    await expect(repository.create(USER, dto, schedule)).resolves.toEqual({
      outcome: 'invalid_target',
    });

    tx.familyMember.findMany.mockResolvedValueOnce([
      {
        id: MEMBER,
        userId: '99999999-9999-4999-8999-999999999999',
        isCareRecipient: false,
        profile: { dateOfBirth: new Date('1980-01-01') },
      },
    ]);
    await expect(repository.create(USER, dto, schedule)).resolves.toEqual({
      outcome: 'invalid_target',
    });

    tx.familyMember.findFirst.mockResolvedValueOnce({
      id: '88888888-8888-4888-8888-888888888888',
      userId: USER,
      canManageCare: true,
      isHired: true,
      careScopes: [],
      family: { ownerUserId: '77777777-7777-4777-8777-777777777777' },
    });
    tx.familyMember.findMany.mockResolvedValueOnce([
      {
        id: MEMBER,
        userId: '99999999-9999-4999-8999-999999999999',
        isCareRecipient: true,
        profile: { dateOfBirth: new Date('1950-01-01') },
      },
    ]);
    await expect(repository.create(USER, dto, schedule)).resolves.toEqual({
      outcome: 'invalid_target',
    });
  });

  it('propagates transaction failure without attempting a partial target write', async () => {
    const { tx, repository } = setup();
    tx.reminder.create.mockRejectedValue(new Error('transaction rollback'));
    await expect(repository.create(USER, dto, schedule)).rejects.toThrow(
      'transaction rollback',
    );
    expect(tx.reminderTarget.createMany).not.toHaveBeenCalled();
  });

  it('uses actor authorization and one advisory lock for atomic target updates', async () => {
    const { tx, repository } = setup();
    await repository.update(
      USER,
      REMINDER,
      { targetMemberIds: [MEMBER] },
      undefined,
      undefined,
    );
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.reminderTarget.deleteMany).toHaveBeenCalledWith({
      where: { reminderId: REMINDER },
    });
    expect(tx.reminderTarget.createMany).toHaveBeenCalled();
    expect(tx.reminderLog.createMany).not.toHaveBeenCalled();
  });

  it('refuses a hired caregiver editing a reminder for someone outside their scope', async () => {
    const { tx, repository } = setup();
    tx.familyMember.findFirst.mockResolvedValue({
      id: 'hired-member',
      userId: USER,
      canManageCare: true,
      isHired: true,
      careScopes: [{ targetMemberId: 'someone-else' }],
      family: { ownerUserId: 'owner-user' },
    });
    await expect(
      repository.update(
        USER,
        REMINDER,
        { title: 'Changed' },
        undefined,
        undefined,
      ),
    ).resolves.toEqual({ outcome: 'forbidden' });
    await expect(repository.deactivate(USER, REMINDER)).resolves.toEqual({
      outcome: 'forbidden',
    });
    expect(tx.reminder.update).not.toHaveBeenCalled();
    expect(tx.reminderTarget.deleteMany).not.toHaveBeenCalled();
  });

  it('lets a hired caregiver edit when every recipient is in scope', async () => {
    const { tx, repository } = setup();
    tx.familyMember.findFirst.mockResolvedValue({
      id: 'hired-member',
      userId: USER,
      canManageCare: true,
      isHired: true,
      careScopes: [{ targetMemberId: MEMBER }],
      family: { ownerUserId: 'owner-user' },
    });
    await expect(
      repository.update(
        USER,
        REMINDER,
        { title: 'Changed' },
        undefined,
        undefined,
      ),
    ).resolves.toMatchObject({ outcome: 'updated' });
  });

  it('claims one durable occurrence and advances schedule inside one serializable transaction', async () => {
    const { tx, repository } = setup();
    tx.reminder.findFirst.mockResolvedValue({
      id: REMINDER,
      familyId: FAMILY,
      scheduleType: 'once',
      timezone: 'UTC',
      startAt: occurrence,
      endAt: occurrence,
      scheduleRule: null,
      targets: [{ memberId: MEMBER, member: { familyId: FAMILY } }],
    });
    const result = await repository.claimOccurrence(
      REMINDER,
      occurrence,
      new Date('2030-01-01T08:01:00Z'),
      new Date('2030-01-01T07:46:00Z'),
    );
    expect(result).toMatchObject({ outcome: 'due' });
    expect(tx.reminderLog.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(tx.reminder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isActive: false }),
      }),
    );
  });

  it('marks stale occurrences missed without notification work', async () => {
    const { tx, repository } = setup();
    tx.reminder.findFirst.mockResolvedValue({
      id: REMINDER,
      familyId: FAMILY,
      scheduleType: 'once',
      timezone: 'UTC',
      startAt: occurrence,
      endAt: occurrence,
      scheduleRule: null,
      targets: [{ memberId: MEMBER, member: { familyId: FAMILY } }],
    });
    const result = await repository.claimOccurrence(
      REMINDER,
      occurrence,
      new Date('2030-01-01T09:00:00Z'),
      new Date('2030-01-01T08:45:00Z'),
    );
    expect(result).toEqual({ outcome: 'missed', dueLogIds: [] });
    expect(tx.reminderLog.findMany).not.toHaveBeenCalled();
  });

  it('requires current accepted active-family membership even for the creator', async () => {
    const { prisma, repository } = setup();
    prisma.reminder.findFirst.mockResolvedValue(null);
    await repository.findVisible(USER, REMINDER);
    expect(prisma.reminder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              creatorUserId: USER,
              family: expect.objectContaining({
                status: 'active',
                members: {
                  some: expect.objectContaining({
                    userId: USER,
                    status: 'accepted',
                  }),
                },
              }),
            }),
          ]),
        }),
      }),
    );
  });
});
