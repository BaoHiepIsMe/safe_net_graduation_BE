-- Phase 2 family-domain integrity. Existing tables and indexes are preserved.

ALTER TABLE "public"."families"
  ALTER COLUMN "status" SET NOT NULL,
  ADD CONSTRAINT "families_status_supported"
  CHECK ("status" IN ('active', 'archived'));

ALTER TABLE "public"."family_members"
  ALTER COLUMN "status" SET NOT NULL,
  ADD CONSTRAINT "family_members_role_supported"
  CHECK ("role" IN ('manager', 'adult', 'child', 'elder')),
  ADD CONSTRAINT "family_members_status_supported"
  CHECK ("status" IN ('pending', 'accepted', 'rejected', 'removed')),
  ADD CONSTRAINT "family_members_label_supported"
  CHECK ("family_label" IN (
    'father', 'mother', 'son', 'daughter',
    'grandfather', 'grandmother', 'caregiver', 'other'
  ));

-- Authorization and invitation-list queries filter by user/family and status.
CREATE INDEX "idx_family_members_user_status"
  ON "public"."family_members" ("user_id", "status");

CREATE INDEX "idx_family_members_family_status"
  ON "public"."family_members" ("family_id", "status");

-- Keep families.owner_user_id consistent with the accepted manager membership.
-- Deferred constraint triggers allow family + owner membership to be inserted in
-- either order inside the same transaction while rejecting inconsistent commits.
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
     AND fm.role = 'manager'
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

DROP TRIGGER IF EXISTS "families_owner_manager_invariant" ON "public"."families";
CREATE CONSTRAINT TRIGGER "families_owner_manager_invariant"
AFTER INSERT OR UPDATE ON "public"."families"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."assert_active_family_owner_manager"();

DROP TRIGGER IF EXISTS "family_members_owner_manager_invariant" ON "public"."family_members";
CREATE CONSTRAINT TRIGGER "family_members_owner_manager_invariant"
AFTER INSERT OR UPDATE OR DELETE ON "public"."family_members"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."assert_active_family_owner_manager"();

REVOKE ALL ON FUNCTION "public"."assert_active_family_owner_manager"()
FROM PUBLIC, anon, authenticated;
