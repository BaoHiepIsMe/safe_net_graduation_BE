import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReminderSchedulerService } from './reminder-scheduler.service';
import { RemindersController } from './reminders.controller';
import { RemindersRepository } from './reminders.repository';
import { RemindersService } from './reminders.service';

@Module({
  imports: [NotificationsModule],
  controllers: [RemindersController],
  providers: [RemindersRepository, RemindersService, ReminderSchedulerService],
  exports: [RemindersRepository, RemindersService, ReminderSchedulerService],
})
export class RemindersModule {}
