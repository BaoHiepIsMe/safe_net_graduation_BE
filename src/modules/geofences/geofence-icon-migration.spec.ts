import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GEOFENCE_ICONS } from './geofences.constants';

describe('geofence icon migration', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20261118090000_geofence_icon',
      'migration.sql',
    ),
    'utf8',
  );

  it('adds a nullable icon column', () => {
    expect(sql).toContain('ALTER TABLE "public"."geofences"');
    expect(sql).toContain('ADD COLUMN "icon" VARCHAR(30)');
    expect(sql).not.toMatch(/"icon"[^,;]*NOT NULL/);
  });

  it('allows exactly the icon keys the API accepts', () => {
    for (const key of GEOFENCE_ICONS) {
      expect(sql).toContain(`'${key}'`);
    }
    expect(sql).toContain('geofences_icon_known');
  });
});
