import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { FamiliesController } from './families.controller';
import { FamilyMembersController } from './family-members.controller';
import { FamiliesService } from './families.service';
import { FamiliesRepository } from './families.repository';
import { FamilyAccessService } from './family-access.service';

@Module({
  imports: [NotificationsModule],
  controllers: [FamiliesController, FamilyMembersController],
  providers: [FamiliesService, FamiliesRepository, FamilyAccessService],
  exports: [FamiliesService, FamiliesRepository, FamilyAccessService],
})
export class FamiliesModule {}
