import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260831110000_phase9_hardening_phase10_cameras/migration.sql',
  ),
  'utf8',
);

describe('Phase 9 hardening and Phase 10 camera migration', () => {
  it('enforces reminder member-family consistency for targets and logs', () => {
    expect(sql).toContain('enforce_reminder_member_family');
    expect(sql).toContain('trg_reminder_targets_family');
    expect(sql).toContain('trg_reminder_logs_family');
  });

  it('normalizes camera lifecycle without claiming fall AI', () => {
    expect(sql).toContain('"cameras_status_check"');
    expect(sql).toContain("CHECK (\"status\" IN ('active', 'inactive'))");
    expect(sql).toContain('"is_fall_detection_enabled" = false');
  });

  it('adds only query-backed family/status indexing', () => {
    expect(sql).toContain('"idx_cameras_family_status"');
    expect(sql).not.toContain('UNIQUE ("family_id", "camera_name")');
  });

  it('preserves forced backend-only camera RLS', () => {
    expect(sql).toContain(
      'ALTER TABLE "public"."cameras" FORCE ROW LEVEL SECURITY',
    );
    expect(sql).toContain(
      'REVOKE ALL ON TABLE "public"."cameras" FROM anon, authenticated',
    );
  });

  it('contains no destructive data or schema operation', () => {
    expect(sql).not.toMatch(/DROP\s+(TABLE|SCHEMA|COLUMN)/i);
    expect(sql).not.toMatch(/TRUNCATE|DELETE\s+FROM|DISABLE\s+ROW\s+LEVEL/i);
  });
});
