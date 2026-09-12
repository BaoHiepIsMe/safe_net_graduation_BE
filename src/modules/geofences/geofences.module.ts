import { Module } from '@nestjs/common';
import { FamiliesModule } from '../families/families.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GeofenceEvaluationService } from './geofence-evaluation.service';
import { GeofencesController } from './geofences.controller';
import { GeofencesRepository } from './geofences.repository';
import { GeofencesService } from './geofences.service';

@Module({
  imports: [FamiliesModule, NotificationsModule],
  controllers: [GeofencesController],
  providers: [GeofencesService, GeofencesRepository, GeofenceEvaluationService],
  exports: [GeofenceEvaluationService],
})
export class GeofencesModule {}
