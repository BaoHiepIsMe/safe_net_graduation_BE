import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { ReminderEventsService } from './reminder-events.service';
import {
  REMINDER_CATCH_UP_WINDOW_MS,
  REMINDER_CONFIRM_WINDOW_MS,
  REMINDER_DUE_BATCH_SIZE,
  REMINDER_SCHEDULER_INTERVAL_MS,
} from './reminders.constants';
import { RemindersRepository } from './reminders.repository';

@Injectable()
export class ReminderSchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ReminderSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly repository: RemindersRepository,
    private readonly notifications: NotificationsService,
    private readonly events: ReminderEventsService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(
      () => void this.runDue(),
      REMINDER_SCHEDULER_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async runDue(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.repository.listDue(now, REMINDER_DUE_BATCH_SIZE);
      const cutoff = new Date(now.getTime() - REMINDER_CATCH_UP_WINDOW_MS);
      for (const reminder of due) {
        if (!reminder.nextOccurrenceAt) continue;
        try {
          const claimed = await this.repository.claimOccurrence(
            reminder.id,
            reminder.nextOccurrenceAt,
            now,
            cutoff,
          );
          // Committed first: managers see "awaiting confirmation" live.
          await this.events.emitLogsUpdated(claimed.dueLogIds, now);
        } catch {
          this.logger.warn('Reminder occurrence persistence failed');
        }
      }
      const pending = await this.repository.listPendingNotificationLogs(
        REMINDER_DUE_BATCH_SIZE,
      );
      for (const log of pending) {
        try {
          await this.notifications.processReminderLog(log.id);
          await this.repository.markNotificationProcessed(log.id);
        } catch {
          this.logger.warn('Reminder notification persistence failed');
        }
      }
      try {
        const missed = await this.repository.markUnconfirmedMissed(
          new Date(now.getTime() - REMINDER_CONFIRM_WINDOW_MS),
          REMINDER_DUE_BATCH_SIZE,
        );
        await this.events.emitLogsUpdated(missed, now);
      } catch {
        this.logger.warn('Reminder missed sweep failed');
      }
    } catch {
      this.logger.warn('Reminder due sweep failed');
    } finally {
      this.running = false;
    }
  }
}
