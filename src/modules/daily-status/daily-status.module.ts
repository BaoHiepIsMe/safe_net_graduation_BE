import { Module } from '@nestjs/common';
import { DailyStatusController } from './daily-status.controller';
import { DailyStatusRepository } from './daily-status.repository';
import { DailyStatusSchedulerService } from './daily-status-scheduler.service';
import { DailyStatusService } from './daily-status.service';

@Module({
  controllers: [DailyStatusController],
  providers: [
    DailyStatusRepository,
    DailyStatusService,
    DailyStatusSchedulerService,
  ],
  exports: [
    DailyStatusRepository,
    DailyStatusService,
    DailyStatusSchedulerService,
  ],
})
export class DailyStatusModule {}
