import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260901110000_phase13_calls_signaling/migration.sql',
  ),
  'utf8',
);

describe('Phase 13 Calls migration', () => {
  it('stops rather than guessing non-empty legacy Call provenance', () => {
    expect(sql).toContain(
      'Phase 13 requires manual legacy call provenance review',
    );
  });

  it('adds durable idempotency and chronological indexes', () => {
    expect(sql).toContain('call_logs_caller_request_key');
    expect(sql).toContain('request_fingerprint');
    expect(sql).toContain('idx_call_logs_conversation_time');
    expect(sql).toContain('idx_call_logs_expiry');
  });

  it('enforces exact direct-Conversation participants and no self-call', () => {
    expect(sql).toContain('enforce_call_conversation_participants');
    expect(sql).toContain("conversation_type\" = 'direct'");
    expect(sql).toContain('call_logs_participants_check');
  });

  it('enforces the truthful state machine and immutable provenance', () => {
    expect(sql).toContain('enforce_call_transition');
    expect(sql).toContain(
      "'ringing', 'accepted', 'rejected', 'cancelled', 'missed', 'ended'",
    );
    expect(sql).toContain('Call provenance is immutable');
  });

  it('uses a DB-unique active participant lock for the busy policy', () => {
    expect(sql).toContain('call_active_participants_user_key');
    expect(sql).toContain('enforce_active_call_participant');
    expect(sql).toContain('release_terminal_call_participants');
    expect(sql).toContain(
      "NEW.\"status\" IN ('rejected', 'cancelled', 'missed', 'ended')",
    );
    expect(sql).toContain(
      'DELETE FROM "public"."call_active_participants" WHERE "call_id" = NEW."id"',
    );
  });

  it('preserves forced backend-only RLS', () => {
    for (const table of ['call_logs', 'call_active_participants']) {
      expect(sql).toContain(
        `ALTER TABLE "public"."${table}" FORCE ROW LEVEL SECURITY`,
      );
      expect(sql).toContain(
        `REVOKE ALL ON TABLE "public"."${table}" FROM anon, authenticated`,
      );
    }
  });

  it('binds incoming Notification provenance to the actual callee Call', () => {
    expect(sql).toContain('enforce_call_notification_source');
    expect(sql).toContain('trg_call_notification_source');
    expect(sql).toContain('Incoming Call Notification must match its Call');
  });

  it('contains no destructive migration-time cleanup', () => {
    expect(sql).not.toMatch(/DROP\s+(TABLE|SCHEMA|COLUMN)|TRUNCATE/i);
    expect(sql).not.toMatch(/DISABLE\s+ROW\s+LEVEL/i);
    expect(sql).not.toMatch(/^DELETE\s+FROM/im);
  });
});
