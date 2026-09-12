-- Phase 6 notification persistence and per-device FCM delivery audit.
UPDATE "public"."notifications" SET "is_read" = false WHERE "is_read" IS NULL;
UPDATE "public"."notifications" SET "created_at" = now() WHERE "created_at" IS NULL;
UPDATE "public"."notifications" SET "read_at" = NULL WHERE "is_read" = false;
UPDATE "public"."notifications" SET "read_at" = "created_at"
  WHERE "is_read" = true AND "read_at" IS NULL;

ALTER TABLE "public"."notifications"
  ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ALTER COLUMN "is_read" SET NOT NULL,
  ALTER COLUMN "created_at" SET NOT NULL;

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_metadata_object_check"
    CHECK (jsonb_typeof("metadata") = 'object'),
  ADD CONSTRAINT "notifications_read_state_check"
    CHECK (("is_read" = false AND "read_at" IS NULL)
       OR ("is_read" = true AND "read_at" IS NOT NULL)),
  ADD CONSTRAINT "notifications_geofence_source_check"
    CHECK ("notification_type" NOT IN ('geofence_enter', 'geofence_exit')
       OR ("related_table" = 'geofence_event'
           AND "related_id" IS NOT NULL
           AND "family_id" IS NOT NULL));

CREATE UNIQUE INDEX "notifications_recipient_source_key"
  ON "public"."notifications"("recipient_user_id", "related_table", "related_id");

CREATE TABLE "public"."notification_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "notification_id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_attempt_at" TIMESTAMPTZ(6),
  "sent_at" TIMESTAMPTZ(6),
  "error_category" VARCHAR(40),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_deliveries_status_check"
    CHECK ("status" IN ('pending', 'sent', 'failed')),
  CONSTRAINT "notification_deliveries_attempt_count_check"
    CHECK ("attempt_count" >= 0),
  CONSTRAINT "notification_deliveries_sent_state_check"
    CHECK (("status" = 'sent' AND "sent_at" IS NOT NULL AND "error_category" IS NULL)
       OR ("status" <> 'sent' AND "sent_at" IS NULL))
);

CREATE UNIQUE INDEX "notification_deliveries_notification_id_device_id_key"
  ON "public"."notification_deliveries"("notification_id", "device_id");
CREATE INDEX "idx_notification_deliveries_status_created"
  ON "public"."notification_deliveries"("status", "created_at");
CREATE INDEX "idx_notification_deliveries_device"
  ON "public"."notification_deliveries"("device_id");

ALTER TABLE "public"."notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_notification_id_fkey"
    FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "notification_deliveries_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "public"."notification_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_deliveries" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."notification_deliveries" FROM anon, authenticated;
