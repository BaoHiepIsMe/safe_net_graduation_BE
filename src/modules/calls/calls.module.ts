import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CallSchedulerService } from './call-scheduler.service';
import {
  CallsController,
  ConversationCallsController,
} from './calls.controller';
import { CallsRepository } from './calls.repository';
import { CallsService } from './calls.service';
import { CallSignalingService } from './call-signaling.service';

@Module({
  imports: [NotificationsModule],
  controllers: [ConversationCallsController, CallsController],
  providers: [
    CallsRepository,
    CallsService,
    CallSchedulerService,
    CallSignalingService,
  ],
  exports: [
    CallsRepository,
    CallsService,
    CallSchedulerService,
    CallSignalingService,
  ],
})
export class CallsModule {}
