import { ErrorCode } from '../../common/constants/error-codes';
import { ReminderEventsService } from './reminder-events.service';
import { RemindersRepository } from './reminders.repository';
import { RemindersService } from './reminders.service';

const USER = '11111111-1111-4111-8111-111111111111';
const FAMILY = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const REMINDER = '44444444-4444-4444-8444-444444444444';
const LOG = '77777777-7777-4777-8777-777777777777';
const at = new Date('2030-01-01T01:00:00Z');

const row = (overrides: Record<string, unknown> = {}) => ({
  id: REMINDER,
  familyId: FAMILY,
  creatorUserId: USER,
  title: 'Medicine',
  description: null,
  reminderType: 'medicine',
  priority: 'normal',
  startAt: at,
  scheduleType: 'once',
  scheduleRule: null,
  timezone: 'Asia/Ho_Chi_Minh',
  endAt: at,
  nextOccurrenceAt: at,
  isActive: true,
  createdAt: new Date('2029-01-01T00:00:00Z'),
  updatedAt: new Date('2029-01-01T00:00:00Z'),
  creator: { id: USER, fullName: 'Manager', avatarUrl: null },
  targets: [
    {
      member: {
        id: MEMBER,
        userId: USER,
        displayName: null,
        status: 'accepted',
        profile: { fullName: 'Manager', avatarUrl: null },
      },
    },
  ],
  ...overrides,
});

describe('RemindersService', () => {
  const setup = () => {
    const repository = {
      create: jest
        .fn()
        .mockResolvedValue({ outcome: 'created', reminder: row() }),
      listVisible: jest.fn().mockResolvedValue([]),
      listUpcoming: jest.fn().mockResolvedValue([]),
      findVisible: jest.fn().mockResolvedValue(row()),
      update: jest
        .fn()
        .mockResolvedValue({ outcome: 'updated', reminder: row() }),
      deactivate: jest
        .fn()
        .mockResolvedValue({ outcome: 'updated', reminder: row() }),
      canView: jest.fn().mockResolvedValue(true),
      listLogs: jest.fn().mockResolvedValue([]),
      completeLog: jest.fn(),
      listAgendaReminders: jest.fn().mockResolvedValue([]),
      viewerMemberships: jest.fn().mockResolvedValue([]),
    };
    const events = { emitLogsUpdated: jest.fn().mockResolvedValue(undefined) };
    return {
      repository,
      events,
      service: new RemindersService(
        repository as unknown as RemindersRepository,
        events as unknown as ReminderEventsService,
      ),
    };
  };

  it('derives creator from auth and passes an atomic normalized schedule', async () => {
    const { repository, service } = setup();
    await service.create(USER, {
      familyId: FAMILY,
      title: 'Medicine',
      schedule: {
        type: 'once',
        occurrenceAt: at.toISOString(),
        timezone: 'Asia/Ho_Chi_Minh',
      },
      targetMemberIds: [MEMBER],
    });
    expect(repository.create).toHaveBeenCalledWith(
      USER,
      expect.not.objectContaining({ createdBy: expect.anything() }),
      expect.objectContaining({ nextOccurrenceAt: at }),
    );
  });

  it('returns stable manager and target authorization errors', async () => {
    const { repository, service } = setup();
    repository.create.mockResolvedValueOnce({ outcome: 'forbidden' });
    await expect(
      service.create(USER, {
        familyId: FAMILY,
        title: 'Denied',
        schedule: {
          type: 'once',
          occurrenceAt: at.toISOString(),
          timezone: 'UTC',
        },
        targetMemberIds: [MEMBER],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.REMINDER_ACCESS_DENIED });
    repository.create.mockResolvedValueOnce({ outcome: 'invalid_target' });
    await expect(
      service.create(USER, {
        familyId: FAMILY,
        title: 'Bad target',
        schedule: {
          type: 'once',
          occurrenceAt: at.toISOString(),
          timezone: 'UTC',
        },
        targetMemberIds: [MEMBER],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.REMINDER_TARGET_INVALID });
  });

  it('hides foreign detail and mutation', async () => {
    const { repository, service } = setup();
    repository.findVisible.mockResolvedValue(null);
    await expect(service.detail(USER, REMINDER)).rejects.toMatchObject({
      code: ErrorCode.REMINDER_NOT_FOUND,
    });
    await expect(
      service.update(USER, REMINDER, { title: 'No' }),
    ).rejects.toMatchObject({
      code: ErrorCode.REMINDER_NOT_FOUND,
    });
  });

  it('soft-deactivates without deleting logs', async () => {
    const { repository, service } = setup();
    await expect(service.deactivate(USER, REMINDER)).resolves.toBeUndefined();
    expect(repository.deactivate).toHaveBeenCalledWith(USER, REMINDER);
  });

  it('recalculates future schedule on update', async () => {
    const { repository, service } = setup();
    await service.update(USER, REMINDER, {
      schedule: {
        type: 'daily',
        timeOfDay: '08:00',
        startsOn: '2030-01-01',
        timezone: 'Asia/Ho_Chi_Minh',
      },
    });
    expect(repository.update).toHaveBeenCalledWith(
      USER,
      REMINDER,
      expect.any(Object),
      expect.objectContaining({ scheduleType: 'daily' }),
      undefined,
    );
  });

  it("refuses an edit or delete outside the caller's care scope", async () => {
    const { repository, service } = setup();
    repository.update.mockResolvedValue({ outcome: 'forbidden' });
    repository.deactivate.mockResolvedValue({ outcome: 'forbidden' });
    await expect(
      service.update(USER, REMINDER, { title: 'No' }),
    ).rejects.toMatchObject({ code: ErrorCode.REMINDER_ACCESS_DENIED });
    await expect(service.deactivate(USER, REMINDER)).rejects.toMatchObject({
      code: ErrorCode.REMINDER_ACCESS_DENIED,
    });
  });

  describe('log history is scoped like the agenda', () => {
    const membership = (overrides: Record<string, unknown>) => ({
      id: MEMBER,
      userId: USER,
      familyId: FAMILY,
      canManageCare: false,
      isHired: false,
      careScopes: [],
      family: { ownerUserId: 'owner' },
      ...overrides,
    });

    const memberFilter = async (overrides: Record<string, unknown>) => {
      const { repository, service } = setup();
      repository.viewerMemberships.mockResolvedValue([membership(overrides)]);
      await service.logs(USER, REMINDER, { limit: 20 });
      return repository.listLogs.mock.calls[0][4];
    };

    it('a plain recipient sees only their own occurrences', async () => {
      expect(await memberFilter({})).toEqual([MEMBER]);
    });

    it('a hired caregiver sees their scope and themself', async () => {
      expect(
        await memberFilter({
          canManageCare: true,
          isHired: true,
          careScopes: [{ targetMemberId: 'child' }],
        }),
      ).toEqual(['child', MEMBER]);
    });

    it('a family manager sees everyone', async () => {
      expect(await memberFilter({ canManageCare: true })).toBeNull();
    });
  });

  it('protects log history with reminder visibility', async () => {
    const { repository, service } = setup();
    repository.findVisible.mockResolvedValue(null);
    await expect(
      service.logs(USER, REMINDER, { limit: 20 }),
    ).rejects.toMatchObject({
      code: ErrorCode.REMINDER_NOT_FOUND,
    });
    expect(repository.listLogs).not.toHaveBeenCalled();
  });

  const logRow = (overrides: Record<string, unknown> = {}) => ({
    id: LOG,
    reminderId: REMINDER,
    memberId: MEMBER,
    scheduledAt: at,
    status: 'completed',
    processedAt: at,
    completedAt: at,
    member: {
      userId: USER,
      displayName: null,
      profile: { fullName: 'Manager', avatarUrl: null },
    },
    ...overrides,
  });

  it('completes a due occurrence and broadcasts it once', async () => {
    const { repository, events, service } = setup();
    repository.completeLog.mockResolvedValue({
      outcome: 'completed',
      changed: true,
      log: logRow(),
    });
    const result = await service.complete(USER, LOG, {});
    expect(result).toMatchObject({ id: LOG, status: 'completed' });
    expect(events.emitLogsUpdated).toHaveBeenCalledWith(
      [LOG],
      expect.any(Date),
    );
  });

  it('does not rebroadcast an already completed occurrence', async () => {
    const { repository, events, service } = setup();
    repository.completeLog.mockResolvedValue({
      outcome: 'completed',
      changed: false,
      log: logRow(),
    });
    await service.complete(USER, LOG, {});
    expect(events.emitLogsUpdated).not.toHaveBeenCalled();
  });

  it('rejects completing a missed or foreign occurrence', async () => {
    const { repository, service } = setup();
    repository.completeLog.mockResolvedValue({ outcome: 'missed' });
    await expect(service.complete(USER, LOG, {})).rejects.toMatchObject({
      code: ErrorCode.REMINDER_OCCURRENCE_CONFLICT,
    });
    repository.completeLog.mockResolvedValue({ outcome: 'not_found' });
    await expect(service.complete(USER, LOG, {})).rejects.toMatchObject({
      code: ErrorCode.REMINDER_LOG_NOT_FOUND,
    });
  });

  describe('agenda', () => {
    const OTHER_USER = '55555555-5555-4555-8555-555555555555';
    const OTHER_MEMBER = '66666666-6666-4666-8666-666666666666';
    const member = (id: string, userId: string, name: string) => ({
      id,
      userId,
      displayName: name,
      status: 'accepted',
      profile: { fullName: null, avatarUrl: null },
    });
    // Daily 08:00 and 20:00 in Asia/Ho_Chi_Minh (UTC+7).
    const daily = (time: string, logs: unknown[] = []) =>
      row({
        id: time === '08:00' ? REMINDER : LOG,
        title: `At ${time}`,
        priority: 'high',
        scheduleType: 'daily',
        scheduleRule: { timeOfDay: time, startsOn: '2030-01-01' },
        startAt: new Date('2030-01-01T01:00:00Z'),
        endAt: null,
        nextOccurrenceAt:
          time === '08:00'
            ? new Date('2030-01-02T01:00:00Z')
            : new Date('2030-01-01T13:00:00Z'),
        targets: [
          { member: member(MEMBER, USER, 'Me') },
          { member: member(OTHER_MEMBER, OTHER_USER, 'Sister') },
        ],
        logs,
      });

    it('merges logged statuses with upcoming occurrences of the day', async () => {
      const { repository, service } = setup();
      repository.listAgendaReminders.mockResolvedValue([
        daily('08:00', [
          {
            id: LOG,
            memberId: MEMBER,
            scheduledAt: new Date('2030-01-01T01:00:00Z'),
            status: 'completed',
            completedAt: new Date('2030-01-01T01:02:00Z'),
            member: member(MEMBER, USER, 'Me'),
          },
        ]),
        daily('20:00'),
      ]);
      repository.viewerMemberships.mockResolvedValue([
        {
          id: MEMBER,
          userId: USER,
          familyId: FAMILY,
          canManageCare: true,
          isHired: false,
          careScopes: [],
          family: { ownerUserId: USER },
        },
      ]);
      const result = await service.agenda(USER, {
        date: '2030-01-01',
        timezone: 'Asia/Ho_Chi_Minh',
      });
      expect(result.startsAt).toEqual(new Date('2029-12-31T17:00:00Z'));
      expect(
        result.data.map((item) => [
          item.title,
          item.member.displayName,
          item.status,
        ]),
      ).toEqual([
        ['At 08:00', 'Me', 'completed'],
        ['At 20:00', 'Me', 'upcoming'],
        ['At 20:00', 'Sister', 'upcoming'],
      ]);
      expect(result.data[0]).toMatchObject({ logId: LOG, priority: 'high' });
      expect(result.data[1].logId).toBeNull();
    });

    it('shows a plain recipient only their own occurrences', async () => {
      const { repository, service } = setup();
      repository.listAgendaReminders.mockResolvedValue([daily('20:00')]);
      repository.viewerMemberships.mockResolvedValue([
        {
          id: MEMBER,
          userId: USER,
          familyId: FAMILY,
          canManageCare: false,
          isHired: false,
          careScopes: [],
          family: { ownerUserId: OTHER_USER },
        },
      ]);
      const result = await service.agenda(USER, {
        date: '2030-01-01',
        timezone: 'Asia/Ho_Chi_Minh',
      });
      expect(result.data.map((item) => item.member.userId)).toEqual([USER]);
    });
  });
});
