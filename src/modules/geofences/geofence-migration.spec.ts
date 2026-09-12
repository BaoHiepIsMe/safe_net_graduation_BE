import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Phase 5 geofence integrity migration', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260824070000_phase5_geofence_integrity',
      'migration.sql',
    ),
    'utf8',
  );

  it('adds durable unique current state and location provenance', () => {
    expect(sql).toContain('CREATE TABLE "public"."geofence_states"');
    expect(sql).toContain('geofence_states_geofence_id_member_id_key');
    expect(sql).toContain('last_location_id');
    expect(sql).toContain('geofence_events_geofence_member_location_key');
  });

  it('enforces geometry and valid transition values', () => {
    expect(sql).toContain('geofences_latitude_range');
    expect(sql).toContain('geofences_longitude_range');
    expect(sql).toContain('geofences_radius_range');
    expect(sql).toContain("event_type\" IN ('enter', 'exit')");
  });

  it('enforces same-family member and location provenance at the database layer', () => {
    expect(sql).toContain('enforce_geofence_family_consistency');
    expect(sql).toContain('geofence_members_family_consistency');
    expect(sql).toContain('geofence_events_family_consistency');
    expect(sql).toContain('geofence_states_family_consistency');
  });

  it('preserves RLS posture for the new state table', () => {
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('FROM anon, authenticated');
  });

  it('contains no destructive table/schema/data operations', () => {
    expect(sql).not.toMatch(/DROP\s+(TABLE|SCHEMA)/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});

describe('Geofence assignment trigger repair migration', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260912100000_fix_geofence_consistency_trigger_record_fields',
      'migration.sql',
    ),
    'utf8',
  );

  it('does not dereference event/state-only NEW fields for geofence_members', () => {
    expect(sql).toContain("to_jsonb(NEW) ->> 'location_id'");
    expect(sql).toContain("to_jsonb(NEW) ->> 'last_location_id'");
    expect(sql).not.toContain('NEW."location_id"');
    expect(sql).not.toContain('NEW."last_location_id"');
    expect(sql).toContain(
      'geofence, member, and family must belong to the same family',
    );
  });
});
