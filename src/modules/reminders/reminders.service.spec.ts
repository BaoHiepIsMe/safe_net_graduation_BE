import { ErrorCode } from '../../common/constants/error-codes';
import { RemindersRepository } from './reminders.repository';
import { RemindersService } from './reminders.service';

const USER = '11111111-1111-4111-8111-111111111111';
const FAMILY = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const REMINDER = '44444444-4444-4444-8444-444444444444';
const at = new Date('2030-01-01T01:00:00Z');

const row = (overrides: Record<string, unknown> = {}) => ({
  id: REMINDER,
  familyId: FAMILY,
  creatorUserId: USER,
  title: 'Medicine',
  description: null,
  reminderType: 'medicine',
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
        role: 'manager',
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
    };
    return {
      repository,
      service: new RemindersService(
        repository as unknown as RemindersRepository,
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

  it('protects log history with reminder visibility', async () => {
    const { repository, service } = setup();
    repository.canView.mockResolvedValue(false);
    await expect(
      service.logs(USER, REMINDER, { limit: 20 }),
    ).rejects.toMatchObject({
      code: ErrorCode.REMINDER_NOT_FOUND,
    });
    expect(repository.listLogs).not.toHaveBeenCalled();
  });
});
