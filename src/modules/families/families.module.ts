import { Module } from '@nestjs/common';
import { FamiliesController } from './families.controller';
import { FamilyMembersController } from './family-members.controller';
import { FamiliesService } from './families.service';
import { FamiliesRepository } from './families.repository';
import { FamilyAccessService } from './family-access.service';

@Module({
  controllers: [FamiliesController, FamilyMembersController],
  providers: [FamiliesService, FamiliesRepository, FamilyAccessService],
  exports: [FamiliesService, FamiliesRepository, FamilyAccessService],
})
export class FamiliesModule {}
