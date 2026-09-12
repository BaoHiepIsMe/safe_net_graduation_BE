import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ServiceUnavailableError } from '../../common/errors/app.error';
import { HealthRepository } from './health.repository';

describe('HealthController', () => {
  it('reports liveness without claiming dependency readiness', async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        {
          provide: HealthRepository,
          useValue: { checkDatabaseConnection: jest.fn() },
        },
      ],
    }).compile();
    const result = module.get(HealthController).getLiveness();
    expect(result.status).toBe('ok');
    expect(result).not.toHaveProperty('database');
  });

  it('fails readiness with a sanitized service error when DB is unavailable', async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        {
          provide: HealthRepository,
          useValue: {
            checkDatabaseConnection: () => {
              throw new Error('secret DB text');
            },
          },
        },
      ],
    }).compile();

    await expect(
      module.get(HealthController).getReadiness(),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
