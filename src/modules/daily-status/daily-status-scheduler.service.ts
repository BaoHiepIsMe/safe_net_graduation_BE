import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DAILY_STATUS_DUE_BATCH_SIZE,
  DAILY_STATUS_SCHEDULER_INTERVAL_MS,
} from './daily-status.constants';
import { DailyStatusRepository } from './daily-status.repository';
import { DailyStatusService } from './daily-status.service';
import { dueReportDate } from './daily-status-window';

@Injectable()
export class DailyStatusSchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(DailyStatusSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly repository: DailyStatusRepository,
    private readonly service: DailyStatusService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(
      () => void this.runDue(),
      DAILY_STATUS_SCHEDULER_INTERVAL_MS,
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
      const timezone =
        this.config.get<string>('dailyStatus.defaultTimezone') ?? 'UTC';
      const graceMinutes =
        this.config.get<number>('dailyStatus.generationGraceMinutes') ?? 60;
      const reportDate = dueReportDate(now, timezone, graceMinutes);
      if (!reportDate) return;
      const dateValue = new Date(`${reportDate}T00:00:00.000Z`);
      const due = await this.repository.listEligibleMissing(
        dateValue,
        timezone,
        DAILY_STATUS_DUE_BATCH_SIZE,
      );
      for (const member of due) {
        try {
          await this.service.generate(
            member.familyId,
            member.id,
            reportDate,
            timezone,
          );
        } catch {
          this.logger.warn('Daily Status generation failed');
        }
      }
    } catch {
      this.logger.warn('Daily Status due sweep failed');
    } finally {
      this.running = false;
    }
  }
}
