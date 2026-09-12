import { Injectable, Logger } from '@nestjs/common';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import {
  GEOFENCE_ENTERED_EVENT,
  GEOFENCE_EXITED_EVENT,
} from './geofences.constants';
import {
  CommittedLocationForGeofences,
  GeofencesRepository,
} from './geofences.repository';

@Injectable()
export class GeofenceEvaluationService {
  private readonly logger = new Logger(GeofenceEvaluationService.name);

  constructor(
    private readonly repository: GeofencesRepository,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  async evaluateCommittedLocation(location: CommittedLocationForGeofences) {
    const transitions =
      await this.repository.evaluateCommittedLocation(location);
    for (const transition of transitions) {
      try {
        await this.notifications.processGeofenceEvent(transition.id);
      } catch {
        this.logger.warn('Geofence notification persistence failed');
      }
      const eventName =
        transition.eventType === 'enter'
          ? GEOFENCE_ENTERED_EVENT
          : GEOFENCE_EXITED_EVENT;
      const payload = {
        id: transition.id,
        familyId: transition.familyId,
        geofence: {
          id: transition.geofenceId,
          name: transition.geofenceName,
        },
        memberId: transition.memberId,
        transition: transition.eventType,
        location: {
          latitude: transition.latitude,
          longitude: transition.longitude,
        },
        occurredAt: transition.occurredAt,
      };
      transition.recipientUserIds.forEach((userId) => {
        try {
          this.realtime.emitToUser(userId, eventName, payload);
        } catch {
          this.logger.warn('Geofence realtime delivery failed after commit');
        }
      });
    }
    return transitions;
  }
}
