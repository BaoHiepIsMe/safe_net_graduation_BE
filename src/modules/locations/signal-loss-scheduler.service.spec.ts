import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  SIGNAL_LOSS_BATCH_SIZE,
  SIGNAL_LOSS_THRESHOLD_MS,
} from './locations.constants';
import {
  LocationsRepository,
  SignalLossCandidateRow,
} from './locations.repository';
import { SignalLossSchedulerService } from './signal-loss-scheduler.service';

const NOW = new Date('2026-11-19T10:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function row(
  overrides: Partial<SignalLossCandidateRow> = {},
): SignalLossCandidateRow {
  return {
    user_id: '11111111-1111-4111-8111-111111111111',
    location_id: '22222222-2222-4222-8222-222222222222',
    latitude: 10.5 as never,
    longitude: 106.5 as never,
    last_location_at: minutesAgo(12),
    last_seen_at: minutesAgo(1),
    sharing_mode: 'continuous',
    ...overrides,
  };
}

function setup(rows: SignalLossCandidateRow[] = [], enabled = true) {
  const repository = {
    listSignalLossCandidates: jest.fn().mockResolvedValue(rows),
  };
  const notifications = {
    processSignalLoss: jest.fn().mockResolvedValue([]),
  };
  const config = {
    get: jest.fn().mockReturnValue(enabled),
  };
  const scheduler = new SignalLossSchedulerService(
    repository as unknown as LocationsRepository,
    notifications as unknown as NotificationsService,
    config as unknown as ConfigService,
  );
  return { scheduler, repository, notifications };
}

describe('SignalLossSchedulerService', () => {
  describe('classify', () => {
    it('blames the connection when the device heartbeat is stale too', () => {
      expect(
        SignalLossSchedulerService.classify(
          row({ last_seen_at: minutesAgo(9) }),
          NOW,
        ),
      ).toBe('no_connection');
    });

    it('blames the location when the app is alive but sends no position', () => {
      expect(
        SignalLossSchedulerService.classify(
          row({ last_seen_at: minutesAgo(2) }),
          NOW,
        ),
      ).toBe('no_location');
    });

    it('uses the longer battery saver threshold', () => {
      const seen = minutesAgo(15); // stale for continuous, fine for the saver
      expect(
        SignalLossSchedulerService.classify(
          row({ last_seen_at: seen, sharing_mode: 'continuous' }),
          NOW,
        ),
      ).toBe('no_connection');
      expect(
        SignalLossSchedulerService.classify(
          row({ last_seen_at: seen, sharing_mode: 'battery_saver' }),
          NOW,
        ),
      ).toBe('no_location');
    });
  });

  describe('runDue', () => {
    it('notifies once per candidate with the silent minutes and reason', async () => {
      const { scheduler, repository, notifications } = setup([
        row(),
        row({
          location_id: '33333333-3333-4333-8333-333333333333',
          last_seen_at: minutesAgo(10),
        }),
      ]);

      await scheduler.runDue(NOW);

      expect(repository.listSignalLossCandidates).toHaveBeenCalledWith(
        NOW,
        SIGNAL_LOSS_BATCH_SIZE,
      );
      expect(notifications.processSignalLoss).toHaveBeenCalledTimes(2);
      expect(notifications.processSignalLoss).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          reason: 'no_location',
          silentMinutes: 12,
          latitude: 10.5,
          longitude: 106.5,
        }),
      );
      expect(notifications.processSignalLoss).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ reason: 'no_connection' }),
      );
    });

    it('keeps going when one notification fails', async () => {
      const { scheduler, notifications } = setup([
        row(),
        row({ location_id: '33333333-3333-4333-8333-333333333333' }),
      ]);
      notifications.processSignalLoss.mockRejectedValueOnce(new Error('db'));

      await scheduler.runDue(NOW);

      expect(notifications.processSignalLoss).toHaveBeenCalledTimes(2);
    });

    it('survives a failing sweep and does not overlap itself', async () => {
      const { scheduler, repository } = setup();
      repository.listSignalLossCandidates.mockRejectedValueOnce(
        new Error('db down'),
      );
      await expect(scheduler.runDue(NOW)).resolves.toBeUndefined();

      let release: (rows: SignalLossCandidateRow[]) => void = () => undefined;
      repository.listSignalLossCandidates.mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      const first = scheduler.runDue(NOW);
      await scheduler.runDue(NOW); // ignored while the first one runs
      release([]);
      await first;
      expect(repository.listSignalLossCandidates).toHaveBeenCalledTimes(2);
    });
  });

  describe('bootstrap', () => {
    afterEach(() => jest.useRealTimers());

    it('does not schedule anything when disabled', () => {
      jest.useFakeTimers();
      const { scheduler, repository } = setup([], false);
      scheduler.onApplicationBootstrap();
      jest.advanceTimersByTime(10 * 60_000);
      expect(repository.listSignalLossCandidates).not.toHaveBeenCalled();
      scheduler.onApplicationShutdown();
    });

    it('sweeps every minute when enabled', () => {
      jest.useFakeTimers();
      const { scheduler, repository } = setup([], true);
      scheduler.onApplicationBootstrap();
      jest.advanceTimersByTime(60_000);
      expect(repository.listSignalLossCandidates).toHaveBeenCalledTimes(1);
      scheduler.onApplicationShutdown();
    });
  });
});

describe('listSignalLossCandidates query', () => {
  function queryText() {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const repository = new LocationsRepository({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);
    void repository.listSignalLossCandidates(NOW, 50);
    const sql = queryRaw.mock.calls[0][0] as {
      sql: string;
      values: unknown[];
    };
    return sql;
  }

  it('limits itself to sharing, non-iOS, not-yet-notified silences', () => {
    const { sql } = queryText();
    expect(sql).toContain('us."location_sharing_enabled" = true');
    expect(sql).toContain('us."notify_on_signal_lost" = true');
    expect(sql).toContain('d."device_type" <> \'ios\'');
    expect(sql).toContain('d."is_active" = true');
    expect(sql).toContain('n."related_table" = \'location_signal\'');
    expect(sql).toContain('ORDER BY c."updated_at" DESC');
  });

  it('passes the per-mode thresholds, the age cap and the limit', () => {
    const { values } = queryText();
    expect(values).toEqual(
      expect.arrayContaining([
        SIGNAL_LOSS_THRESHOLD_MS.continuous / 1000,
        SIGNAL_LOSS_THRESHOLD_MS.battery_saver / 1000,
        24 * 60 * 60,
        50,
      ]),
    );
  });

  it('only considers phones somebody else in the family could be told', () => {
    const { sql } = queryText();
    expect(sql).toContain('other."user_id" <> me."user_id"');
    expect(sql).toContain('f."status" = \'active\'');
  });
});
