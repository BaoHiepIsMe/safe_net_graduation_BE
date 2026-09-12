import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260901090000_phase11_phone_management/migration.sql',
  ),
  'utf8',
);

describe('Phase 11 phone management migration', () => {
  it('adds durable usage and command idempotency', () => {
    expect(sql).toContain('phone_usage_device_record_key');
    expect(sql).toContain('phone_commands_creator_request_key');
    expect(sql).toContain('request_fingerprint');
  });

  it('enforces current child/family/device target binding', () => {
    expect(sql).toContain('enforce_phone_target_binding');
    expect(sql).toContain('trg_phone_usage_target_binding');
    expect(sql).toContain('trg_phone_rule_target_binding');
    expect(sql).toContain('trg_phone_command_target_binding');
  });

  it('protects the command state machine and immutable provenance', () => {
    expect(sql).toContain('enforce_phone_command_transition');
    expect(sql).toContain("('pending', 'sent', 'completed', 'failed')");
    expect(sql).toContain('Phone command provenance is immutable');
  });

  it('preserves forced backend-only RLS', () => {
    for (const table of ['phone_usage_logs', 'phone_rules', 'phone_commands']) {
      expect(sql).toContain(
        `ALTER TABLE "public"."${table}" FORCE ROW LEVEL SECURITY`,
      );
      expect(sql).toContain(
        `REVOKE ALL ON TABLE "public"."${table}" FROM anon, authenticated`,
      );
    }
  });

  it('does not delete data or destructive schema objects', () => {
    expect(sql).not.toMatch(/DROP\s+(TABLE|SCHEMA|COLUMN)/i);
    expect(sql).not.toMatch(/TRUNCATE|DELETE\s+FROM|DISABLE\s+ROW\s+LEVEL/i);
  });
});
