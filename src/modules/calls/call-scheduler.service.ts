import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { CALL_DUE_BATCH_SIZE, CALL_SWEEP_INTERVAL_MS } from './calls.constants';
import { CallsRepository } from './calls.repository';
import { CallsService } from './calls.service';

@Injectable()
export class CallSchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(CallSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly repository: CallsRepository,
    private readonly calls: CallsService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.runDue(), CALL_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async runDue(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      let expired;
      try {
        expired = await this.repository.expireDue(now, CALL_DUE_BATCH_SIZE);
      } catch {
        this.logger.warn('Missed Call sweep failed');
        return;
      }
      for (const call of expired) {
        try {
          await this.calls.emitMissed(call.id);
        } catch {
          this.logger.warn('Missed Call realtime delivery failed');
        }
      }
    } finally {
      this.running = false;
    }
  }
}
