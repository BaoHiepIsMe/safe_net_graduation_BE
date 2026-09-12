-- Phase 14: deterministic, persisted, non-AI Daily Status snapshots.
-- The inspected legacy table was empty. Deployment stops if legacy rows appear
-- rather than guessing their subject, timezone, or reporting boundaries.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "public"."daily_status_reports") THEN
    RAISE EXCEPTION 'Phase 14 requires manual legacy DailyStatusReport provenance review';
  END IF;
END
$$;

ALTER TABLE "public"."daily_status_reports"
  ADD COLUMN "subject_user_id" UUID NOT NULL,
  ADD COLUMN "timezone" VARCHAR(100) NOT NULL,
  ADD COLUMN "day_start" TIMESTAMPTZ(6) NOT NULL,
  ADD COLUMN "day_end" TIMESTAMPTZ(6) NOT NULL,
  ADD COLUMN "schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "summary" JSONB NOT NULL,
  ADD COLUMN "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  ALTER COLUMN "created_at" SET DEFAULT now(),
  ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE "public"."daily_status_reports"
  DROP CONSTRAINT "daily_status_reports_family_id_fkey",
  DROP CONSTRAINT "daily_status_reports_member_id_fkey",
  ADD CONSTRAINT "daily_status_reports_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "public"."families"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "daily_status_reports_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "public"."family_members"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "daily_status_reports_subject_user_id_fkey"
    FOREIGN KEY ("subject_user_id") REFERENCES "public"."profiles"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "daily_status_reports_timezone_check"
    CHECK (length(btrim("timezone")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "daily_status_reports_window_check" CHECK (
    "day_end" > "day_start"
    AND ("day_start" AT TIME ZONE "timezone")::date = "report_date"
    AND ("day_end" AT TIME ZONE "timezone")::date = "report_date" + 1
    AND "day_start" = ("report_date"::timestamp AT TIME ZONE "timezone")
    AND "day_end" = (("report_date" + 1)::timestamp AT TIME ZONE "timezone")
  ),
  ADD CONSTRAINT "daily_status_reports_schema_version_check"
    CHECK ("schema_version" = 1),
  ADD CONSTRAINT "daily_status_reports_summary_object_check"
    CHECK (jsonb_typeof("summary") = 'object'),
  ADD CONSTRAINT "daily_status_reports_legacy_ai_null_check" CHECK (
    "location_summary" IS NULL
    AND "phone_usage_summary" IS NULL
    AND "reminder_summary" IS NULL
    AND "fall_risk_level" IS NULL
    AND "activity_level" IS NULL
    AND "ai_summary" IS NULL
    AND "ai_data" IS NULL
  );

ALTER TABLE "public"."daily_status_reports"
DROP CONSTRAINT IF EXISTS "daily_status_reports_member_id_report_date_key";
DROP INDEX IF EXISTS "public"."idx_daily_reports_member_date";
CREATE UNIQUE INDEX "daily_status_reports_context_key"
  ON "public"."daily_status_reports"
    ("family_id", "subject_user_id", "report_date", "timezone");
CREATE INDEX "idx_daily_reports_subject_date"
  ON "public"."daily_status_reports"
    ("subject_user_id", "report_date" DESC, "id" DESC);
CREATE INDEX "idx_daily_reports_family_member_date"
  ON "public"."daily_status_reports"
    ("family_id", "member_id", "report_date" DESC, "id" DESC);

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
    WHERE fm."id" = NEW."member_id"
      AND fm."family_id" = NEW."family_id"
      AND fm."user_id" = NEW."subject_user_id"
      AND fm."status" = 'accepted'
      AND fm."role" IN ('child', 'elder')
      AND f."status" = 'active'
  ) THEN
    RAISE EXCEPTION 'Daily Status subject must be an eligible current family member';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_daily_status_context"
BEFORE INSERT ON "public"."daily_status_reports"
FOR EACH ROW EXECUTE FUNCTION "public"."enforce_daily_status_context"();

CREATE OR REPLACE FUNCTION "public"."enforce_daily_status_immutable"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Finalized Daily Status reports are immutable';
END;
$$;

CREATE TRIGGER "trg_daily_status_immutable"
BEFORE UPDATE ON "public"."daily_status_reports"
FOR EACH ROW EXECUTE FUNCTION "public"."enforce_daily_status_immutable"();

ALTER TABLE "public"."daily_status_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."daily_status_reports" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."daily_status_reports" FROM anon, authenticated;
REVOKE ALL ON FUNCTION "public"."enforce_daily_status_context"() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION "public"."enforce_daily_status_immutable"() FROM PUBLIC, anon, authenticated;
