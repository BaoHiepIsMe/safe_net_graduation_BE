import { NotificationsService } from '../notifications/notifications.service';
import { ReminderSchedulerService } from './reminder-scheduler.service';
import { RemindersRepository } from './reminders.repository';

const REMINDER = '11111111-1111-4111-8111-111111111111';
const LOG = '22222222-2222-4222-8222-222222222222';
const now = new Date('2030-01-01T08:05:00Z');

describe('ReminderSchedulerService', () => {
  const setup = () => {
    const repository = {
      listDue: jest.fn().mockResolvedValue([]),
      claimOccurrence: jest
        .fn()
        .mockResolvedValue({ outcome: 'due', dueLogIds: [LOG] }),
      listPendingNotificationLogs: jest.fn().mockResolvedValue([]),
      markNotificationProcessed: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const notifications = {
      processReminderLog: jest.fn().mockResolvedValue([]),
    };
    return {
      repository,
      notifications,
      service: new ReminderSchedulerService(
        repository as unknown as RemindersRepository,
        notifications as unknown as NotificationsService,
      ),
    };
  };

  it('persists due occurrence before processing its notification', async () => {
    const { repository, notifications, service } = setup();
    repository.listDue.mockResolvedValue([
      { id: REMINDER, nextOccurrenceAt: new Date('2030-01-01T08:00:00Z') },
    ]);
    repository.listPendingNotificationLogs.mockResolvedValue([{ id: LOG }]);
    await service.runDue(now);
    expect(repository.claimOccurrence).toHaveBeenCalled();
    expect(notifications.processReminderLog).toHaveBeenCalledWith(LOG);
    expect(repository.markNotificationProcessed).toHaveBeenCalledWith(LOG);
  });

  it('retries durable pending notification work after orchestration failure', async () => {
    const { repository, notifications, service } = setup();
    repository.listPendingNotificationLogs.mockResolvedValue([{ id: LOG }]);
    notifications.processReminderLog.mockRejectedValue(
      new Error('DB unavailable'),
    );
    await service.runDue(now);
    expect(repository.markNotificationProcessed).not.toHaveBeenCalled();
  });

  it('does not process inactive reminders absent from the due query', async () => {
    const { repository, service } = setup();
    await service.runDue(now);
    expect(repository.claimOccurrence).not.toHaveBeenCalled();
  });

  it('passes a bounded catch-up cutoff to durable processing', async () => {
    const { repository, service } = setup();
    repository.listDue.mockResolvedValue([
      { id: REMINDER, nextOccurrenceAt: new Date('2030-01-01T07:00:00Z') },
    ]);
    await service.runDue(now);
    expect(repository.claimOccurrence).toHaveBeenCalledWith(
      REMINDER,
      expect.any(Date),
      now,
      new Date('2030-01-01T07:50:00Z'),
    );
  });

  it('prevents overlapping local ticks while DB constraints protect other instances', async () => {
    const { repository, service } = setup();
    let release!: () => void;
    repository.listDue.mockReturnValue(
      new Promise((resolve) => (release = () => resolve([]))),
    );
    const first = service.runDue(now);
    await expect(service.runDue(now)).resolves.toBeUndefined();
    release();
    await first;
    expect(repository.listDue).toHaveBeenCalledTimes(1);
  });
});
