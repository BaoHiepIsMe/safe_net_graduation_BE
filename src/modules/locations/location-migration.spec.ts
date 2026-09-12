import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Phase 4 location integrity migration', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260824060000_phase4_location_integrity',
      'migration.sql',
    ),
    'utf8',
  );

  it('adds per-user/device history and current projection integrity', () => {
    expect(sql).toContain('locations_user_id_fkey');
    expect(sql).toContain('idx_locations_user_time_id');
    expect(sql).toContain('current_locations_pkey');
    expect(sql).toContain('current_locations_location_id_fkey');
  });

  it('adds coordinate and telemetry checks', () => {
    expect(sql).toContain('locations_latitude_range');
    expect(sql).toContain('locations_longitude_range');
    expect(sql).toContain('locations_accuracy_nonnegative');
    expect(sql).toContain('locations_speed_nonnegative');
    expect(sql).toContain('locations_heading_range');
  });

  it('preserves tables, schemas, data, RLS and functions', () => {
    expect(sql).not.toMatch(/DROP\s+(TABLE|SCHEMA)/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
    expect(sql).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});
