-- Reminders carry a priority chosen by the manager (low → urgent).
ALTER TABLE "public"."reminders"
  ADD COLUMN "priority" VARCHAR(20) NOT NULL DEFAULT 'normal';

ALTER TABLE "public"."reminders"
  ADD CONSTRAINT "reminders_priority_check"
  CHECK ("priority" IN ('low', 'normal', 'high', 'urgent'));

-- A recipient confirms an occurrence: due → completed, stamped once.
ALTER TABLE "public"."reminder_logs"
  ADD COLUMN "completed_at" TIMESTAMPTZ(6);

ALTER TABLE "public"."reminder_logs"
  DROP CONSTRAINT "reminder_logs_status_check";

ALTER TABLE "public"."reminder_logs"
  ADD CONSTRAINT "reminder_logs_status_check"
    CHECK ("status" IN ('due', 'completed', 'missed')),
  ADD CONSTRAINT "reminder_logs_completed_at_check"
    CHECK (("status" = 'completed') = ("completed_at" IS NOT NULL));

-- The scheduler marks unconfirmed due occurrences as missed.
CREATE INDEX "idx_reminder_logs_status_time"
  ON "public"."reminder_logs"("status", "scheduled_at");
