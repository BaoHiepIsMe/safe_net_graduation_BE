import { Injectable } from '@nestjs/common';
import { CallsRepository } from './calls.repository';

@Injectable()
export class CallSignalingService {
  constructor(private readonly repository: CallsRepository) {}

  authorize(userId: string, callId: string, signalType: string) {
    return this.repository.authorizeSignal(userId, callId, signalType);
  }
}
