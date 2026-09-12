import { ConfigService } from '@nestjs/config';
import { DailyStatusRepository } from './daily-status.repository';
import { DailyStatusSchedulerService } from './daily-status-scheduler.service';
import { DailyStatusService } from './daily-status.service';

describe('DailyStatusSchedulerService', () => {
  it('generates one bounded due batch after local grace time', async () => {
    const repository = {
      listEligibleMissing: jest
        .fn()
        .mockResolvedValue([{ id: 'member-1', familyId: 'family-1' }]),
    };
    const service = { generate: jest.fn() };
    const config = {
      get: jest.fn((key: string) =>
        key.endsWith('defaultTimezone') ? 'Asia/Ho_Chi_Minh' : 60,
      ),
    };
    const scheduler = new DailyStatusSchedulerService(
      repository as unknown as DailyStatusRepository,
      service as unknown as DailyStatusService,
      config as unknown as ConfigService,
    );
    await scheduler.runDue(new Date('2026-09-01T18:00:00.000Z'));
    expect(repository.listEligibleMissing).toHaveBeenCalledWith(
      new Date('2026-09-01T00:00:00.000Z'),
      'Asia/Ho_Chi_Minh',
      50,
    );
    expect(service.generate).toHaveBeenCalledWith(
      'family-1',
      'member-1',
      '2026-09-01',
      'Asia/Ho_Chi_Minh',
    );
  });

  it('skips before grace and does not overlap local ticks', async () => {
    const repository = { listEligibleMissing: jest.fn() };
    const scheduler = new DailyStatusSchedulerService(
      repository as unknown as DailyStatusRepository,
      { generate: jest.fn() } as unknown as DailyStatusService,
      {
        get: jest.fn((key: string) =>
          key.endsWith('defaultTimezone') ? 'UTC' : 60,
        ),
      } as unknown as ConfigService,
    );
    await scheduler.runDue(new Date('2026-09-02T00:30:00.000Z'));
    expect(repository.listEligibleMissing).not.toHaveBeenCalled();
  });
});
