import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Phase 3 device integrity migration', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260820050000_phase3_device_integrity',
      'migration.sql',
    ),
    'utf8',
  );

  it('adds stable identity, FCM routing and telemetry constraints', () => {
    expect(sql).toContain('devices_installation_id_key');
    expect(sql).toContain('devices_fcm_token_key');
    expect(sql).toContain('devices_platform_supported');
    expect(sql).toContain('devices_battery_level_range');
    expect(sql).toContain('devices_fcm_token_format');
  });

  it('preserves the existing table and all data', () => {
    expect(sql).not.toMatch(/DROP\s+(TABLE|SCHEMA)/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
  });
});
