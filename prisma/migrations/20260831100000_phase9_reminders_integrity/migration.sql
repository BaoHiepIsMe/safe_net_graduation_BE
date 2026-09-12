-- Phase 9: durable, timezone-aware reminders and idempotent occurrences.
-- Forward-only; this migration preserves all existing reminder data.

ALTER TABLE "public"."reminders"
  ADD COLUMN "timezone" VARCHAR(100) NOT NULL DEFAULT 'UTC',
  ADD COLUMN "next_occurrence_at" TIMESTAMPTZ(6);

UPDATE "public"."reminders"
SET
  "repeat_type" = CASE WHEN "repeat_type" IS NULL OR "repeat_type" = 'none' THEN 'once' ELSE "repeat_type" END,
  "is_active" = COALESCE("is_active", true),
  "created_at" = COALESCE("created_at", now()),
  "updated_at" = COALESCE("updated_at", now()),
  "next_occurrence_at" = CASE
    WHEN COALESCE("is_active", true) AND "start_time" >= now() THEN "start_time"
    ELSE NULL
  END;

ALTER TABLE "public"."reminders"
  ALTER COLUMN "repeat_type" SET DEFAULT 'once',
  ALTER COLUMN "repeat_type" SET NOT NULL,
  ALTER COLUMN "is_active" SET DEFAULT true,
  ALTER COLUMN "is_active" SET NOT NULL,
  ALTER COLUMN "created_at" SET DEFAULT now(),
  ALTER COLUMN "created_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET DEFAULT now(),
  ALTER COLUMN "updated_at" SET NOT NULL,
  ADD CONSTRAINT "reminders_schedule_type_check"
    CHECK ("repeat_type" IN ('once', 'daily', 'weekly')),
  ADD CONSTRAINT "reminders_timezone_check"
    CHECK (length(btrim("timezone")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "reminders_schedule_rule_check"
    CHECK ("repeat_rule" IS NULL OR jsonb_typeof("repeat_rule") = 'object'),
  ADD CONSTRAINT "reminders_end_time_check"
    CHECK ("end_time" IS NULL OR "end_time" >= "start_time"),
  ADD CONSTRAINT "reminders_next_occurrence_check"
    CHECK ("next_occurrence_at" IS NULL OR "next_occurrence_at" >= "start_time"),
  ADD CONSTRAINT "reminders_title_check"
    CHECK (length(btrim("title")) BETWEEN 1 AND 150);

UPDATE "public"."reminder_logs"
SET "status" = CASE
  WHEN "status" IS NULL OR "status" = 'pending' THEN 'due'
  WHEN "status" IN ('due', 'missed') THEN "status"
  ELSE 'missed'
END;

ALTER TABLE "public"."reminder_logs"
  ADD COLUMN "notification_processed_at" TIMESTAMPTZ(6),
  ALTER COLUMN "status" SET DEFAULT 'due',
  ALTER COLUMN "status" SET NOT NULL,
  ADD CONSTRAINT "reminder_logs_status_check"
    CHECK ("status" IN ('due', 'missed'));

CREATE UNIQUE INDEX "reminder_logs_occurrence_key"
  ON "public"."reminder_logs"("reminder_id", "member_id", "scheduled_at");
CREATE INDEX "idx_reminder_logs_notification_pending"
  ON "public"."reminder_logs"("notification_processed_at", "scheduled_at");
CREATE INDEX "idx_reminders_due"
  ON "public"."reminders"("is_active", "next_occurrence_at");
CREATE INDEX "idx_reminders_creator_time"
  ON "public"."reminders"("created_by", "created_at" DESC);

ALTER TABLE "public"."reminder_logs"
  DROP CONSTRAINT "reminder_logs_member_id_fkey",
  DROP CONSTRAINT "reminder_logs_reminder_id_fkey",
  ADD CONSTRAINT "reminder_logs_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "public"."family_members"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "reminder_logs_reminder_id_fkey"
    FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "public"."reminder_targets"
  DROP CONSTRAINT "reminder_targets_member_id_fkey",
  ADD CONSTRAINT "reminder_targets_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "public"."family_members"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "public"."reminders"
  DROP CONSTRAINT "reminders_family_id_fkey",
  DROP CONSTRAINT "reminders_created_by_fkey",
  ADD CONSTRAINT "reminders_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "public"."families"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "reminders_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_reminder_source_check"
    CHECK ("notification_type" <> 'reminder'
       OR ("related_table" = 'reminder_log' AND "related_id" IS NOT NULL));

ALTER TABLE "public"."reminders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."reminders" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."reminder_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."reminder_targets" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."reminder_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."reminder_logs" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."reminders" FROM anon, authenticated;
REVOKE ALL ON TABLE "public"."reminder_targets" FROM anon, authenticated;
REVOKE ALL ON TABLE "public"."reminder_logs" FROM anon, authenticated;
