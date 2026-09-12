import { CallsRepository } from './calls.repository';
import { CallSchedulerService } from './call-scheduler.service';
import { CallsService } from './calls.service';

describe('CallSchedulerService', () => {
  it('sweeps a bounded DB-authoritative due batch and emits only committed misses', async () => {
    const repository = {
      expireDue: jest
        .fn()
        .mockResolvedValue([{ id: 'call-1' }, { id: 'call-2' }]),
    };
    const calls = { emitMissed: jest.fn() };
    const scheduler = new CallSchedulerService(
      repository as unknown as CallsRepository,
      calls as unknown as CallsService,
    );
    const now = new Date();
    await scheduler.runDue(now);
    expect(repository.expireDue).toHaveBeenCalledWith(now, 50);
    expect(calls.emitMissed).toHaveBeenCalledTimes(2);
  });

  it('does not overlap process-local sweeps while DB transition remains authoritative', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repository = {
      expireDue: jest.fn().mockImplementation(() => pending.then(() => [])),
    };
    const scheduler = new CallSchedulerService(
      repository as unknown as CallsRepository,
      { emitMissed: jest.fn() } as unknown as CallsService,
    );
    const first = scheduler.runDue();
    await scheduler.runDue();
    expect(repository.expireDue).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});
