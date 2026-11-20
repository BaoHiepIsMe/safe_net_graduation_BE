import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../notifications/notifications.service';
import {
  SIGNAL_LOSS_BATCH_SIZE,
  SIGNAL_LOSS_SCAN_INTERVAL_MS,
  SIGNAL_LOSS_THRESHOLD_MS,
  SignalLossReason,
} from './locations.constants';
import {
  LocationsRepository,
  SignalLossCandidateRow,
} from './locations.repository';

/**
 * Looks for phones that stopped reporting and tells their family once per
 * silence. "no_connection": the device did not even send its heartbeat.
 * "no_location": the app is alive but gives no position (GPS off, permission
 * revoked). Both are guesses about the cause, so the wording says "có thể".
 */
@Injectable()
export class SignalLossSchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SignalLossSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly repository: LocationsRepository,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get<boolean>('signalLoss.enabled') === false) {
      this.logger.log('Signal-loss alerts are disabled');
      return;
    }
    this.timer = setInterval(
      () => void this.runDue(),
      SIGNAL_LOSS_SCAN_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  static classify(
    row: Pick<SignalLossCandidateRow, 'last_seen_at' | 'sharing_mode'>,
    now: Date,
  ): SignalLossReason {
    const threshold =
      row.sharing_mode === 'battery_saver'
        ? SIGNAL_LOSS_THRESHOLD_MS.battery_saver
        : SIGNAL_LOSS_THRESHOLD_MS.continuous;
    return now.getTime() - row.last_seen_at.getTime() >= threshold
      ? 'no_connection'
      : 'no_location';
  }

  async runDue(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.repository.listSignalLossCandidates(
        now,
        SIGNAL_LOSS_BATCH_SIZE,
      );
      for (const row of rows) {
        try {
          await this.notifications.processSignalLoss({
            userId: row.user_id,
            locationId: row.location_id,
            reason: SignalLossSchedulerService.classify(row, now),
            silentMinutes: Math.floor(
              (now.getTime() - row.last_location_at.getTime()) / 60_000,
            ),
            lastLocationAt: row.last_location_at,
            lastSeenAt: row.last_seen_at,
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
          });
        } catch {
          this.logger.warn('Signal-loss notification persistence failed');
        }
      }
    } catch {
      this.logger.warn('Signal-loss sweep failed');
    } finally {
      this.running = false;
    }
  }
}
