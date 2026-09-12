import { PrismaService } from '../../infrastructure/database/prisma.service';
import { DailyStatusRepository } from './daily-status.repository';

const FAMILY = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const REPORT = '44444444-4444-4444-8444-444444444444';
const DATE = new Date('2026-09-01T00:00:00.000Z');
const START = new Date('2026-08-31T17:00:00.000Z');
const END = new Date('2026-09-01T17:00:00.000Z');

const report = () => ({
  id: REPORT,
  familyId: FAMILY,
  memberId: MEMBER,
  subjectUserId: USER,
  reportDate: DATE,
  timezone: 'Asia/Ho_Chi_Minh',
  dayStart: START,
  dayEnd: END,
  schemaVersion: 1,
  summary: {},
  generatedAt: END,
  createdAt: END,
  subject: { id: USER, fullName: 'Subject', avatarUrl: null },
});

function transactionFixture() {
  let stored: any = null;
  const tx: any = {
    $queryRaw: jest.fn(),
    familyMember: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: MEMBER, userId: USER, role: 'child' }),
    },
    dailyStatusReport: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(stored)),
      create: jest.fn().mockImplementation(({ data }: any) => {
        stored = report();
        stored.summary = data.summary;
        return Promise.resolve(stored);
      }),
    },
    location: {
      aggregate: jest.fn().mockResolvedValue({
        _count: { _all: 2 },
        _max: { recordedAt: new Date('2026-09-01T10:00:00.000Z') },
      }),
    },
    geofenceEvent: {
      groupBy: jest.fn().mockResolvedValue([
        { event_type: 'enter', _count: { _all: 2 } },
        { event_type: 'exit', _count: { _all: 1 } },
      ]),
    },
    geofenceMember: { count: jest.fn().mockResolvedValue(1) },
    sosEvent: {
      groupBy: jest
        .fn()
        .mockResolvedValue([{ status: 'resolved', _count: { _all: 1 } }]),
    },
    reminderLog: {
      groupBy: jest
        .fn()
        .mockResolvedValue([{ status: 'due', _count: { _all: 3 } }]),
      count: jest.fn().mockResolvedValue(2),
    },
    reminderTarget: { count: jest.fn().mockResolvedValue(1) },
    phoneUsageLog: {
      aggregate: jest.fn().mockResolvedValue({
        _count: { _all: 2 },
        _sum: { durationSeconds: 300 },
      }),
      groupBy: jest.fn().mockResolvedValue([
        {
          appPackage: 'app.safe',
          appName: 'Safe App',
          _sum: { durationSeconds: 300 },
        },
      ]),
    },
    phoneRule: { count: jest.fn().mockResolvedValue(1) },
  };
  let tail = Promise.resolve();
  const prisma = {
    $transaction: jest.fn((work: (client: any) => unknown) => {
      const current = tail.then(() => work(tx));
      tail = current.then(
        () => undefined,
        () => undefined,
      );
      return current;
    }),
  } as unknown as PrismaService;
  return { tx, repository: new DailyStatusRepository(prisma) };
}

describe('DailyStatusRepository generation', () => {
  it('aggregates exact factual metrics with one shared half-open window', async () => {
    const { repository, tx } = transactionFixture();
    const result: any = await repository.generate(
      FAMILY,
      MEMBER,
      DATE,
      'Asia/Ho_Chi_Minh',
      START,
      END,
    );
    expect(result.outcome).toBe('created');
    expect(result.report.summary).toMatchObject({
      location: { recordCount: 2 },
      geofence: { enterCount: 2, exitCount: 1 },
      sos: { totalCount: 1, resolvedCount: 1 },
      reminders: {
        occurrenceCount: 3,
        notificationProcessedCount: 2,
      },
      phoneUsage: { totalUsageSeconds: 300 },
    });
    expect(tx.location.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recordedAt: { gte: START, lt: END },
        }),
      }),
    );
    expect(tx.geofenceEvent.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          detected_at: { gte: START, lt: END },
        }),
      }),
    );
    expect(tx.reminderLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scheduledAt: { gte: START, lt: END },
        }),
      }),
    );
  });

  it('concurrent generation produces one report and one reused result', async () => {
    const { repository, tx } = transactionFixture();
    const outcomes = await Promise.all([
      repository.generate(FAMILY, MEMBER, DATE, 'Asia/Ho_Chi_Minh', START, END),
      repository.generate(FAMILY, MEMBER, DATE, 'Asia/Ho_Chi_Minh', START, END),
    ]);
    expect(outcomes.map((item) => item.outcome).sort()).toEqual([
      'created',
      'reused',
    ]);
    expect(tx.dailyStatusReport.create).toHaveBeenCalledTimes(1);
  });

  it('does not persist a fake report for an ineligible subject', async () => {
    const { repository, tx } = transactionFixture();
    tx.familyMember.findFirst.mockResolvedValue(null);
    await expect(
      repository.generate(FAMILY, MEMBER, DATE, 'UTC', START, END),
    ).resolves.toEqual({ outcome: 'ineligible' });
    expect(tx.dailyStatusReport.create).not.toHaveBeenCalled();
  });
});
