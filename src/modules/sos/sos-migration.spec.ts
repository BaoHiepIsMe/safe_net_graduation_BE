import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Phase 7 SOS integrity migration', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260831090000_phase7_sos_integrity',
      'migration.sql',
    ),
    'utf8',
  );

  it('adds durable actor idempotency and a one-active-incident invariant', () => {
    expect(sql).toContain('sos_events_actor_request_key');
    expect(sql).toContain('sos_events_one_active_actor_key');
    expect(sql).toContain('WHERE "status" = \'active\'');
    expect(sql).toContain('request_fingerprint');
  });

  it('enforces immutable snapshots and the minimal lifecycle', () => {
    expect(sql).toContain('sos_events_location_snapshot_check');
    expect(sql).toContain('sos_events_update_guard');
    expect(sql).toContain("'active', 'resolved', 'cancelled'");
    expect(sql).toContain('invalid SOS state transition');
  });

  it('adds durable unique recipient provenance and SOS notification source integrity', () => {
    expect(sql).toContain('CREATE TABLE "public"."sos_recipients"');
    expect(sql).toContain('sos_recipients_sos_event_id_recipient_user_id_key');
    expect(sql).toContain('notifications_sos_source_check');
  });

  it('makes contacts owner-scoped and validates normalized phones', () => {
    expect(sql).toContain('owner_user_id');
    expect(sql).toContain('sos_contacts_owner_phone_key');
    expect(sql).toContain('sos_contacts_owner_linked_user_key');
    expect(sql).toContain('sos_contacts_phone_format_check');
  });

  it('preserves forced backend-only RLS without destructive data operations', () => {
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('FROM anon, authenticated');
    expect(sql).not.toMatch(/DROP\s+(TABLE|SCHEMA)/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
  });
});
