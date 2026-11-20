import { Module } from '@nestjs/common';
import { FamiliesModule } from '../families/families.module';
import { GeofencesModule } from '../geofences/geofences.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LocationsController } from './locations.controller';
import { LocationsRepository } from './locations.repository';
import { LocationsService } from './locations.service';
import { SignalLossSchedulerService } from './signal-loss-scheduler.service';

@Module({
  imports: [FamiliesModule, GeofencesModule, NotificationsModule],
  controllers: [LocationsController],
  providers: [
    LocationsService,
    LocationsRepository,
    SignalLossSchedulerService,
  ],
  exports: [LocationsService, LocationsRepository],
})
export class LocationsModule {}
