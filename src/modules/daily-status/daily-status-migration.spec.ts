import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260902120000_phase14_daily_status_reports/migration.sql',
  ),
  'utf8',
);

describe('Phase 14 Daily Status migration', () => {
  it('stops instead of guessing legacy report provenance', () => {
    expect(sql).toContain(
      'Phase 14 requires manual legacy DailyStatusReport provenance review',
    );
  });

  it('adds durable subject, timezone, window and summary context', () => {
    for (const field of [
      'subject_user_id',
      'timezone',
      'day_start',
      'day_end',
      'schema_version',
      'summary',
      'generated_at',
    ]) {
      expect(sql).toContain(`"${field}"`);
    }
    expect(sql).toContain('daily_status_reports_window_check');
  });

  it('enforces one report per canonical context', () => {
    expect(sql).toContain('daily_status_reports_context_key');
    expect(sql).toContain(
      '("family_id", "subject_user_id", "report_date", "timezone")',
    );
  });

  it('enforces eligible same-family subject provenance and immutability', () => {
    expect(sql).toContain('enforce_daily_status_context');
    expect(sql).toContain("fm.\"role\" IN ('child', 'elder')");
    expect(sql).toContain('Finalized Daily Status reports are immutable');
  });

  it('keeps all legacy AI and narrative fields null', () => {
    expect(sql).toContain('daily_status_reports_legacy_ai_null_check');
    expect(sql).toContain('"fall_risk_level" IS NULL');
    expect(sql).toContain('"ai_summary" IS NULL');
  });

  it('preserves forced backend-only RLS', () => {
    expect(sql).toContain(
      'ALTER TABLE "public"."daily_status_reports" FORCE ROW LEVEL SECURITY',
    );
    expect(sql).toContain(
      'REVOKE ALL ON TABLE "public"."daily_status_reports" FROM anon, authenticated',
    );
  });

  it('contains no destructive data cleanup or table/schema/column removal', () => {
    expect(sql).not.toMatch(
      /DROP\s+(TABLE|SCHEMA|COLUMN)|TRUNCATE|DELETE\s+FROM/i,
    );
    expect(sql).not.toMatch(/DISABLE\s+ROW\s+LEVEL/i);
  });
});
