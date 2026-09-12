import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Phase 2 family integrity migration', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260820040000_phase2_family_integrity',
      'migration.sql',
    ),
    'utf8',
  );

  it('constrains family roles, statuses and relationship labels', () => {
    expect(sql).toContain('family_members_role_supported');
    expect(sql).toContain('family_members_status_supported');
    expect(sql).toContain('family_members_label_supported');
    expect(sql).toContain('families_status_supported');
  });

  it('adds authorization indexes without recreating tables', () => {
    expect(sql).toContain('idx_family_members_user_status');
    expect(sql).toContain('idx_family_members_family_status');
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
  });

  it('defers the owner accepted-manager invariant until commit', () => {
    expect(sql).toContain('assert_active_family_owner_manager');
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(sql).toContain("fm.role = 'manager'");
    expect(sql).toContain("fm.status = 'accepted'");
  });
});
