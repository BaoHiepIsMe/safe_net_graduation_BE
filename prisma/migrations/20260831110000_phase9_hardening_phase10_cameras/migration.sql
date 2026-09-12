-- Phase 9 authorization hardening and Phase 10 camera management integrity.
-- Forward-only; preserves all existing records and backend-only RLS posture.

CREATE OR REPLACE FUNCTION "public"."enforce_reminder_member_family"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  reminder_family UUID;
  member_family UUID;
BEGIN
  SELECT "family_id" INTO reminder_family
  FROM "public"."reminders"
  WHERE "id" = NEW."reminder_id";

  SELECT "family_id" INTO member_family
  FROM "public"."family_members"
  WHERE "id" = NEW."member_id";

  IF reminder_family IS NULL OR member_family IS NULL OR reminder_family <> member_family THEN
    RAISE EXCEPTION 'Reminder member must belong to the reminder family';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_reminder_targets_family" ON "public"."reminder_targets";
CREATE TRIGGER "trg_reminder_targets_family"
BEFORE INSERT OR UPDATE OF "reminder_id", "member_id"
ON "public"."reminder_targets"
FOR EACH ROW EXECUTE FUNCTION "public"."enforce_reminder_member_family"();

DROP TRIGGER IF EXISTS "trg_reminder_logs_family" ON "public"."reminder_logs";
CREATE TRIGGER "trg_reminder_logs_family"
BEFORE INSERT OR UPDATE OF "reminder_id", "member_id"
ON "public"."reminder_logs"
FOR EACH ROW EXECUTE FUNCTION "public"."enforce_reminder_member_family"();

REVOKE ALL ON FUNCTION "public"."enforce_reminder_member_family"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."enforce_reminder_member_family"() FROM anon, authenticated;

UPDATE "public"."cameras"
SET
  "is_fall_detection_enabled" = false,
  "status" = CASE WHEN "status" = 'inactive' THEN 'inactive' ELSE 'active' END,
  "created_at" = COALESCE("created_at", now()),
  "updated_at" = COALESCE("updated_at", now());

ALTER TABLE "public"."cameras"
  ALTER COLUMN "is_fall_detection_enabled" SET DEFAULT false,
  ALTER COLUMN "is_fall_detection_enabled" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'active',
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "created_at" SET DEFAULT now(),
  ALTER COLUMN "created_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET DEFAULT now(),
  ALTER COLUMN "updated_at" SET NOT NULL,
  ADD CONSTRAINT "cameras_name_check"
    CHECK (length(btrim("camera_name")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "cameras_location_check"
    CHECK ("location_name" IS NULL OR length(btrim("location_name")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "cameras_status_check"
    CHECK ("status" IN ('active', 'inactive'));

CREATE INDEX "idx_cameras_family_status"
  ON "public"."cameras"("family_id", "status");

ALTER TABLE "public"."cameras"
  DROP CONSTRAINT "cameras_family_id_fkey",
  DROP CONSTRAINT "cameras_created_by_fkey",
  ADD CONSTRAINT "cameras_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "public"."families"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "cameras_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "public"."cameras" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."cameras" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."cameras" FROM anon, authenticated;
