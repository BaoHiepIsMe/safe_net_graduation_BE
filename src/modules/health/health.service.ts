import { Injectable } from '@nestjs/common';
import { ServiceUnavailableError } from '../../common/errors/app.error';
import { HealthRepository } from './health.repository';

@Injectable()
export class HealthService {
  constructor(private readonly repository: HealthRepository) {}

  checkLiveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
    };
  }

  async checkReadiness() {
    try {
      await this.repository.checkDatabaseConnection();

      return {
        status: 'ready',
        timestamp: new Date().toISOString(),
        dependencies: { database: 'available' },
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableError) throw error;
      throw new ServiceUnavailableError();
    }
  }
}
