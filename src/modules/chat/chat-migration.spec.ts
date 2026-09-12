import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260901100000_phase12_chat_messaging/migration.sql',
  ),
  'utf8',
);

describe('Phase 12 chat migration', () => {
  it('blocks ambiguous non-empty legacy data instead of guessing provenance', () => {
    expect(sql).toContain(
      'Phase 12 requires manual legacy chat provenance review',
    );
  });

  it('enforces direct uniqueness and durable message idempotency', () => {
    expect(sql).toContain('conversations_family_direct_key');
    expect(sql).toContain('messages_conversation_sender_client_key');
    expect(sql).toContain('request_fingerprint');
  });

  it('enforces current family membership for members and senders', () => {
    expect(sql).toContain('enforce_conversation_member_family');
    expect(sql).toContain('enforce_message_sender');
    expect(sql).toContain('fm."status" = \'accepted\'');
    expect(sql).toContain('f."status" = \'active\'');
  });

  it('enforces a monotonic conversation read cursor', () => {
    expect(sql).toContain('enforce_conversation_read_cursor');
    expect(sql).toContain('Conversation read cursor cannot regress');
  });

  it('restricts Phase 12 to text-only messages', () => {
    expect(sql).toContain('messages_type_check');
    expect(sql).toContain('"message_type" = \'text\'');
    expect(sql).toContain('messages_media_deferred_check');
  });

  it('preserves backend-only forced RLS without destructive cleanup', () => {
    for (const table of ['conversations', 'conversation_members', 'messages']) {
      expect(sql).toContain(
        `ALTER TABLE "public"."${table}" FORCE ROW LEVEL SECURITY`,
      );
      expect(sql).toContain(
        `REVOKE ALL ON TABLE "public"."${table}" FROM anon, authenticated`,
      );
    }
    expect(sql).not.toMatch(
      /DROP\s+(TABLE|SCHEMA|COLUMN)|TRUNCATE|DELETE\s+FROM/i,
    );
    expect(sql).not.toMatch(/DISABLE\s+ROW\s+LEVEL/i);
  });
});
