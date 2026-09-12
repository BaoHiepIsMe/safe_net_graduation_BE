import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260831100000_phase9_reminders_integrity/migration.sql',
  ),
  'utf8',
);

describe('Phase 9 reminder migration', () => {
  it('adds timezone-aware indexed next-due state', () => {
    expect(sql).toContain('"next_occurrence_at"');
    expect(sql).toContain('"timezone"');
    expect(sql).toContain('"idx_reminders_due"');
  });

  it('enforces one log per reminder, member and occurrence', () => {
    expect(sql).toContain('"reminder_logs_occurrence_key"');
    expect(sql).toContain('"reminder_id", "member_id", "scheduled_at"');
  });

  it('adds durable notification retry state and source integrity', () => {
    expect(sql).toContain('"notification_processed_at"');
    expect(sql).toContain('"notifications_reminder_source_check"');
    expect(sql).toContain("'reminder_log'");
  });

  it('keeps reminder tables forced-RLS and backend-only', () => {
    expect(sql.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(3);
    expect(sql).toContain('REVOKE ALL ON TABLE "public"."reminder_logs"');
  });

  it('contains no destructive data or schema operations', () => {
    expect(sql).not.toMatch(/DROP\s+(TABLE|SCHEMA|COLUMN)/i);
    expect(sql).not.toMatch(/TRUNCATE|DELETE\s+FROM|DISABLE\s+ROW\s+LEVEL/i);
  });
});
