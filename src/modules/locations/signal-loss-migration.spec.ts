import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('signal loss alerts migration', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20261119090000_signal_loss_alerts',
      'migration.sql',
    ),
    'utf8',
  );

  it('adds an opt-out that defaults to on', () => {
    expect(sql).toContain(
      '"notify_on_signal_lost" BOOLEAN NOT NULL DEFAULT true',
    );
  });

  it('indexes the column the sweep filters on', () => {
    expect(sql).toContain('"idx_current_locations_updated_at"');
    expect(sql).toContain('"public"."current_locations"("updated_at")');
  });
});
