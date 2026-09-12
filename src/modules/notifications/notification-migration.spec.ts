import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Phase 6 notification integrity migration', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260827080000_phase6_notifications_delivery',
      'migration.sql',
    ),
    'utf8',
  );

  it('enforces durable source idempotency and read state', () => {
    expect(sql).toContain('notifications_recipient_source_key');
    expect(sql).toContain('notifications_read_state_check');
    expect(sql).toContain('notifications_geofence_source_check');
    expect(sql).toContain('ALTER COLUMN "is_read" SET NOT NULL');
  });

  it('tracks one auditable delivery per notification and device', () => {
    expect(sql).toContain('CREATE TABLE "public"."notification_deliveries"');
    expect(sql).toContain(
      'notification_deliveries_notification_id_device_id_key',
    );
    expect(sql).toContain("'pending', 'sent', 'failed'");
    expect(sql).toContain('attempt_count');
  });

  it('forces backend-only RLS without destructive operations', () => {
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('FROM anon, authenticated');
    expect(sql).not.toMatch(/DROP\s+(TABLE|SCHEMA)/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
  });
});
