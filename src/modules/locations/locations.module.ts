import { Module } from '@nestjs/common';
import { FamiliesModule } from '../families/families.module';
import { GeofencesModule } from '../geofences/geofences.module';
import { LocationsController } from './locations.controller';
import { LocationsRepository } from './locations.repository';
import { LocationsService } from './locations.service';

@Module({
  imports: [FamiliesModule, GeofencesModule],
  controllers: [LocationsController],
  providers: [LocationsService, LocationsRepository],
  exports: [LocationsService, LocationsRepository],
})
export class LocationsModule {}
