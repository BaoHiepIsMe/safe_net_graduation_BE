import { Injectable, Logger } from '@nestjs/common';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway';
import { mapReminderLog } from './reminder-mappers';
import { REMINDER_LOG_UPDATED_EVENT } from './reminders.constants';
import { RemindersRepository } from './reminders.repository';

/** Tells the recipient and the family's managers that occurrences changed. */
@Injectable()
export class ReminderEventsService {
  private readonly logger = new Logger(ReminderEventsService.name);

  constructor(
    private readonly repository: RemindersRepository,
    private readonly realtime: RealtimeGateway,
  ) {}

  async emitLogsUpdated(logIds: string[], now = new Date()) {
    if (logIds.length === 0) return;
    try {
      const logs = await this.repository.findLogsForBroadcast(logIds);
      for (const log of logs) {
        const managers = await this.repository.managerUserIds(
          log.reminder.familyId,
          log.memberId,
        );
        const recipients = new Set([
          log.member.userId,
          log.reminder.creatorUserId,
          ...managers,
        ]);
        const payload = {
          ...mapReminderLog(log),
          occurredAt: now.toISOString(),
        };
        for (const userId of recipients) {
          this.realtime.emitToUser(userId, REMINDER_LOG_UPDATED_EVENT, payload);
        }
      }
    } catch {
      this.logger.warn('Reminder realtime delivery failed');
    }
  }
}
