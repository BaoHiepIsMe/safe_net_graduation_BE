-- Phase: Care roles, scopes, UI mode, and requested join status.
-- Forward-only migration: preserves legacy profiles.role and family_members.role
-- columns until Flutter completes migration, while moving all database invariants
-- and triggers to the new care-role model.

-- 1. profiles.ui_mode
ALTER TABLE "public"."profiles"
  ADD COLUMN "ui_mode" VARCHAR(20) NOT NULL DEFAULT 'adult',
  ADD CONSTRAINT "profiles_ui_mode_supported"
    CHECK ("ui_mode" IN ('kid', 'adult', 'assisted'));

UPDATE "public"."profiles"
SET "ui_mode" = CASE
  WHEN "date_of_birth" IS NOT NULL
   AND EXTRACT(YEAR FROM age((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, "date_of_birth")) < 13
    THEN 'kid'
  WHEN "date_of_birth" IS NOT NULL
   AND EXTRACT(YEAR FROM age((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, "date_of_birth")) >= 60
    THEN 'assisted'
  ELSE 'adult'
END;

GRANT SELECT ("ui_mode"), UPDATE ("ui_mode") ON "public"."profiles" TO authenticated;

-- 2. Signup trigger: write ui_mode (computed from age in Asia/Ho_Chi_Minh when metadata omits it),
-- stop reading raw_user_meta_data->>'role'. Keep profiles.role nullable.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    dob DATE;
    meta_ui_mode TEXT;
    resolved_ui_mode VARCHAR(20);
    age_years INTEGER;
BEGIN
    dob := NULLIF(NEW.raw_user_meta_data->>'date_of_birth', '')::date;
    meta_ui_mode := NULLIF(NEW.raw_user_meta_data->>'ui_mode', '');

    IF dob IS NOT NULL THEN
        age_years := EXTRACT(YEAR FROM age((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, dob))::int;
    ELSE
        age_years := NULL;
    END IF;

    IF age_years IS NOT NULL AND age_years < 13 THEN
        resolved_ui_mode := 'kid';
    ELSIF meta_ui_mode IN ('adult', 'assisted') THEN
        resolved_ui_mode := meta_ui_mode;
    ELSIF age_years IS NOT NULL AND age_years >= 60 THEN
        resolved_ui_mode := 'assisted';
    ELSE
        resolved_ui_mode := 'adult';
    END IF;

    INSERT INTO public.profiles (
        id, full_name, email, phone, avatar_url, gender, date_of_birth, ui_mode
    )
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        NEW.email,
        CASE
            WHEN NULLIF(NEW.phone, '') IS NOT NULL
                THEN '+' || ltrim(NEW.phone, '+')
            ELSE NULLIF(NEW.raw_user_meta_data->>'phone_number', '')
        END,
        NEW.raw_user_meta_data->>'avatar_url',
        NULLIF(NEW.raw_user_meta_data->>'gender', ''),
        dob,
        resolved_ui_mode
    );
    INSERT INTO public.user_settings (user_id) VALUES (NEW.id);
    INSERT INTO public.biometric_settings (user_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 3. family_members new columns & updated status/label constraints.
-- Keep family_members.role nullable so new code no longer writes it.
ALTER TABLE "public"."family_members"
  ALTER COLUMN "role" DROP NOT NULL,
  ADD COLUMN "can_manage_care" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "care_granted_by" UUID NULL,
  ADD COLUMN "is_care_recipient" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "care_recipient_set_by" UUID NULL,
  ADD COLUMN "is_hired" BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT "family_members_care_granted_by_fkey"
    FOREIGN KEY ("care_granted_by") REFERENCES "public"."profiles"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "family_members_care_recipient_set_by_fkey"
    FOREIGN KEY ("care_recipient_set_by") REFERENCES "public"."profiles"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "public"."family_members"
  DROP CONSTRAINT "family_members_status_supported",
  ADD CONSTRAINT "family_members_status_supported"
    CHECK ("status" IN ('pending', 'requested', 'accepted', 'rejected', 'removed')),
  DROP CONSTRAINT "family_members_label_supported",
  ADD CONSTRAINT "family_members_label_supported"
    CHECK ("family_label" IN (
      'father', 'mother', 'son', 'daughter',
      'grandfather', 'grandmother', 'caregiver', 'other',
      'husband', 'wife', 'brother', 'sister', 'grandchild'
    ));

-- 4. family_member_care_scopes table, same-family trigger, and RLS.
CREATE TABLE "public"."family_member_care_scopes" (
  "member_id" UUID NOT NULL,
  "target_member_id" UUID NOT NULL,
  CONSTRAINT "family_member_care_scopes_pkey"
    PRIMARY KEY ("member_id", "target_member_id"),
  CONSTRAINT "family_member_care_scopes_not_self"
    CHECK ("member_id" <> "target_member_id"),
  CONSTRAINT "family_member_care_scopes_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "public"."family_members"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "family_member_care_scopes_target_member_id_fkey"
    FOREIGN KEY ("target_member_id") REFERENCES "public"."family_members"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX "idx_family_member_care_scopes_target"
  ON "public"."family_member_care_scopes"("target_member_id");

CREATE OR REPLACE FUNCTION "public"."enforce_care_scope_same_family"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  actor_family UUID;
  target_family UUID;
BEGIN
  SELECT "family_id" INTO actor_family
  FROM "public"."family_members"
  WHERE "id" = NEW."member_id";

  SELECT "family_id" INTO target_family
  FROM "public"."family_members"
  WHERE "id" = NEW."target_member_id";

  IF actor_family IS NULL OR target_family IS NULL OR actor_family <> target_family THEN
    RAISE EXCEPTION 'care scope members must belong to the same family'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_care_scope_same_family" ON "public"."family_member_care_scopes";
CREATE TRIGGER "trg_care_scope_same_family"
  BEFORE INSERT OR UPDATE ON "public"."family_member_care_scopes"
  FOR EACH ROW EXECUTE FUNCTION "public"."enforce_care_scope_same_family"();

ALTER TABLE "public"."family_member_care_scopes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."family_member_care_scopes" FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "public"."family_member_care_scopes" FROM anon, authenticated;
REVOKE ALL ON FUNCTION "public"."enforce_care_scope_same_family"() FROM PUBLIC, anon, authenticated;

-- 5. Backfill family_members and family_member_care_scopes from legacy role/label.
UPDATE "public"."family_members" fm
SET
  "can_manage_care" = CASE
    WHEN p."date_of_birth" IS NOT NULL
     AND EXTRACT(YEAR FROM age((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, p."date_of_birth")) < 18
      THEN false
    WHEN fm."role" = 'manager'
      OR (fm."role" = 'adult' AND fm."family_label" IN ('father', 'mother'))
      OR fm."family_label" = 'caregiver'
      THEN true
    ELSE false
  END,
  "is_care_recipient" = CASE
    WHEN fm."role" = 'elder' THEN true
    WHEN fm."role" = 'child' AND p."date_of_birth" IS NULL THEN true
    ELSE false
  END,
  "is_hired" = (fm."family_label" = 'caregiver')
FROM "public"."profiles" p
WHERE p."id" = fm."user_id";

INSERT INTO "public"."family_member_care_scopes" ("member_id", "target_member_id")
SELECT caregiver."id", target."id"
FROM "public"."family_members" caregiver
JOIN "public"."family_members" target
  ON target."family_id" = caregiver."family_id"
 AND target."id" <> caregiver."id"
JOIN "public"."profiles" tp
  ON tp."id" = target."user_id"
WHERE caregiver."is_hired" = true
  AND (
    target."is_care_recipient" = true
    OR (
      tp."date_of_birth" IS NOT NULL
      AND EXTRACT(YEAR FROM age((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, tp."date_of_birth")) < 18
    )
  )
ON CONFLICT ("member_id", "target_member_id") DO NOTHING;

-- 5b. Legacy families owned by a minor. The backfill above cleared the minor's
-- can_manage_care, which would break the owner invariant below. Hand ownership to
-- the first accepted adult non-hired member (managers first). With no adult at all,
-- keep the minor owner as manager so the family stays usable (technical debt).
DO $$
DECLARE
  fam RECORD;
  heir RECORD;
BEGIN
  FOR fam IN
    SELECT f."id", f."owner_user_id"
    FROM "public"."families" f
    JOIN "public"."profiles" op ON op."id" = f."owner_user_id"
    WHERE f."status" = 'active'
      AND op."date_of_birth" IS NOT NULL
      AND EXTRACT(YEAR FROM age((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, op."date_of_birth")) < 18
  LOOP
    SELECT fm."id", fm."user_id" INTO heir
    FROM "public"."family_members" fm
    JOIN "public"."profiles" p ON p."id" = fm."user_id"
    WHERE fm."family_id" = fam."id"
      AND fm."status" = 'accepted'
      AND fm."is_hired" = false
      AND fm."user_id" <> fam."owner_user_id"
      AND (
        p."date_of_birth" IS NULL
        OR EXTRACT(YEAR FROM age((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, p."date_of_birth")) >= 18
      )
    ORDER BY fm."can_manage_care" DESC, fm."created_at" ASC, fm."id" ASC
    LIMIT 1;

    IF FOUND THEN
      UPDATE "public"."family_members"
      SET "can_manage_care" = true,
          "care_granted_by" = COALESCE("care_granted_by", fam."owner_user_id")
      WHERE "id" = heir."id";
      UPDATE "public"."families"
      SET "owner_user_id" = heir."user_id"
      WHERE "id" = fam."id";
    ELSE
      UPDATE "public"."family_members"
      SET "can_manage_care" = true
      WHERE "family_id" = fam."id"
        AND "user_id" = fam."owner_user_id";
    END IF;
  END LOOP;
END $$;

-- 6. Invariant trigger: minor (< 18 in Asia/Ho_Chi_Minh) cannot have can_manage_care = true.
CREATE OR REPLACE FUNCTION "public"."enforce_adult_care_manager"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  dob DATE;
BEGIN
  IF NEW."can_manage_care" = true THEN
    SELECT p."date_of_birth" INTO dob
    FROM "public"."profiles" p
    WHERE p."id" = NEW."user_id";

    IF dob IS NOT NULL
       AND EXTRACT(YEAR FROM age((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, dob)) < 18 THEN
      RAISE EXCEPTION 'minor under 18 cannot have can_manage_care'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_family_members_adult_care_manager" ON "public"."family_members";
CREATE TRIGGER "trg_family_members_adult_care_manager"
  BEFORE INSERT OR UPDATE OF "can_manage_care", "user_id"
  ON "public"."family_members"
  FOR EACH ROW EXECUTE FUNCTION "public"."enforce_adult_care_manager"();

REVOKE ALL ON FUNCTION "public"."enforce_adult_care_manager"() FROM PUBLIC, anon, authenticated;

-- 7. Update owner invariant trigger: active family owner must be an accepted member
-- with can_manage_care = true (no longer depends on legacy role).
CREATE OR REPLACE FUNCTION "public"."assert_active_family_owner_manager"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  target_family_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'families' THEN
    IF TG_OP = 'DELETE' THEN
      target_family_id := OLD.id;
    ELSE
      target_family_id := NEW.id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      target_family_id := OLD.family_id;
    ELSE
      target_family_id := NEW.family_id;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."families" f
    WHERE f.id = target_family_id
      AND f.status = 'active'
  ) AND NOT EXISTS (
    SELECT 1
    FROM "public"."families" f
    JOIN "public"."family_members" fm
      ON fm.family_id = f.id
     AND fm.user_id = f.owner_user_id
     AND fm.can_manage_care = true
     AND fm.status = 'accepted'
    WHERE f.id = target_family_id
  ) THEN
    RAISE EXCEPTION 'active family owner must be an accepted manager'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION "public"."assert_active_family_owner_manager"()
FROM PUBLIC, anon, authenticated;

-- 8. Update phone management target binding function to check isMinor (< 18 in Asia/Ho_Chi_Minh)
-- instead of legacy target_role <> 'child'.
CREATE OR REPLACE FUNCTION "public"."enforce_phone_target_binding"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  target_user UUID;
  target_family UUID;
  target_dob DATE;
  target_status TEXT;
  family_status TEXT;
  device_user UUID;
  device_active BOOLEAN;
  expected_family UUID;
  expected_device UUID;
BEGIN
  SELECT fm."user_id", fm."family_id", p."date_of_birth", fm."status", f."status"
  INTO target_user, target_family, target_dob, target_status, family_status
  FROM "public"."family_members" fm
  JOIN "public"."families" f ON f."id" = fm."family_id"
  JOIN "public"."profiles" p ON p."id" = fm."user_id"
  WHERE fm."id" = NEW."member_id";

  expected_family := COALESCE(
    (to_jsonb(NEW) ->> 'family_id')::UUID,
    target_family
  );

  IF target_user IS NULL OR target_family <> expected_family
     OR target_dob IS NULL
     OR EXTRACT(YEAR FROM age((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, target_dob)) >= 18
     OR target_status <> 'accepted'
     OR family_status <> 'active' THEN
    RAISE EXCEPTION 'Phone target must be an accepted child in the active family';
  END IF;

  IF TG_TABLE_NAME IN ('phone_usage_logs', 'phone_commands') THEN
    expected_device := COALESCE(
      (to_jsonb(NEW) ->> 'device_id')::UUID,
      (to_jsonb(NEW) ->> 'target_device_id')::UUID
    );
    SELECT "user_id", "is_active" INTO device_user, device_active
    FROM "public"."devices"
    WHERE "id" = expected_device;
    IF device_user IS NULL OR device_user <> target_user OR NOT device_active THEN
      RAISE EXCEPTION 'Phone target device must be active and owned by the target child';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION "public"."enforce_phone_target_binding"() FROM PUBLIC, anon, authenticated;

-- 9. Update daily status context trigger function to check isCareRecipient
-- (age < 18 in Asia/Ho_Chi_Minh OR fm.is_care_recipient = true) instead of legacy role.
CREATE OR REPLACE FUNCTION "public"."enforce_daily_status_context"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "public"."family_members" fm
    JOIN "public"."families" f ON f."id" = fm."family_id"
    JOIN "public"."profiles" p ON p."id" = fm."user_id"
    WHERE fm."id" = NEW."member_id"
      AND fm."family_id" = NEW."family_id"
      AND fm."user_id" = NEW."subject_user_id"
      AND fm."status" = 'accepted'
      AND (
        fm."is_care_recipient" = true
        OR (
          p."date_of_birth" IS NOT NULL
          AND EXTRACT(YEAR FROM age((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, p."date_of_birth")) < 18
        )
      )
      AND f."status" = 'active'
  ) THEN
    RAISE EXCEPTION 'Daily Status subject must be an eligible current family member';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION "public"."enforce_daily_status_context"() FROM PUBLIC, anon, authenticated;
