import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Care roles and scopes migration', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20261120090000_care_roles_and_scopes',
      'migration.sql',
    ),
    'utf8',
  );

  it('adds profiles.ui_mode with constraint and updates handle_new_user without reading role', () => {
    expect(sql).toContain('"ui_mode" VARCHAR(20) NOT NULL DEFAULT \'adult\'');
    expect(sql).toContain('profiles_ui_mode_supported');
    expect(sql).toContain(
      "CHECK (\"ui_mode\" IN ('kid', 'adult', 'assisted'))",
    );
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.handle_new_user()',
    );
    expect(sql).toContain("NEW.raw_user_meta_data->>'ui_mode'");
    expect(sql).not.toContain("NEW.raw_user_meta_data->>'role'");
  });

  it('adds care-role columns and requested status / new labels to family_members without dropping role', () => {
    expect(sql).toContain('"can_manage_care" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).toContain('"care_granted_by" UUID NULL');
    expect(sql).toContain('"is_care_recipient" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).toContain('"care_recipient_set_by" UUID NULL');
    expect(sql).toContain('"is_hired" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).toContain(
      "CHECK (\"status\" IN ('pending', 'requested', 'accepted', 'rejected', 'removed'))",
    );
    for (const label of [
      'husband',
      'wife',
      'brother',
      'sister',
      'grandchild',
    ]) {
      expect(sql).toContain(`'${label}'`);
    }
    expect(sql).not.toMatch(/DROP\s+COLUMN\s+"?role"?/i);
  });

  it('creates family_member_care_scopes with composite PK, FKs, same-family trigger, and forced RLS', () => {
    expect(sql).toContain('CREATE TABLE "public"."family_member_care_scopes"');
    expect(sql).toContain('PRIMARY KEY ("member_id", "target_member_id")');
    expect(sql).toContain('enforce_care_scope_same_family');
    expect(sql).toContain(
      'ALTER TABLE "public"."family_member_care_scopes" ENABLE ROW LEVEL SECURITY',
    );
    expect(sql).toContain(
      'ALTER TABLE "public"."family_member_care_scopes" FORCE ROW LEVEL SECURITY',
    );
    expect(sql).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE "public"."family_member_care_scopes" FROM anon, authenticated',
    );
  });

  it('hands minor-owned legacy families to an adult before the owner invariant changes', () => {
    const handover = sql.indexOf('-- 5b. Legacy families owned by a minor');
    const ownerInvariant = sql.indexOf(
      'CREATE OR REPLACE FUNCTION "public"."assert_active_family_owner_manager"()',
    );
    expect(handover).toBeGreaterThan(-1);
    expect(handover).toBeLessThan(ownerInvariant);
    expect(sql).toContain('SET "owner_user_id" = heir."user_id"');
    expect(sql).toContain('AND fm."is_hired" = false');
  });

  it('enforces adult-only can_manage_care and updates owner, phone, and daily-status triggers', () => {
    expect(sql).toContain('enforce_adult_care_manager');
    expect(sql).toContain('Asia/Ho_Chi_Minh');
    expect(sql).toContain('assert_active_family_owner_manager');
    expect(sql).toContain('fm.can_manage_care = true');
    expect(sql).toContain('enforce_phone_target_binding');
    expect(sql).toContain('enforce_daily_status_context');
  });
});
