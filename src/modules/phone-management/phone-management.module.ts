import { Module } from '@nestjs/common';
import { PhoneManagementController } from './phone-management.controller';
import { PhoneManagementRepository } from './phone-management.repository';
import { PhoneManagementService } from './phone-management.service';

@Module({
  controllers: [PhoneManagementController],
  providers: [PhoneManagementRepository, PhoneManagementService],
  exports: [PhoneManagementRepository, PhoneManagementService],
})
export class PhoneManagementModule {}
