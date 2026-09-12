-- Phase 7: evolve the existing SOS tables for actor-owned, idempotent manual
-- emergencies while preserving the deployed tables and backend-only posture.

ALTER TABLE "public"."sos_contacts"
  ADD COLUMN "owner_user_id" UUID,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "public"."sos_contacts" sc
SET "owner_user_id" = fm."user_id",
    "contact_name" = COALESCE(NULLIF(trim(sc."contact_name"), ''), 'Emergency contact'),
    "priority" = COALESCE(sc."priority", 1),
    "is_active" = COALESCE(sc."is_active", true),
    "created_at" = COALESCE(sc."created_at", CURRENT_TIMESTAMP)
FROM "public"."family_members" fm
WHERE fm."id" = sc."member_id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "public"."sos_contacts"
    WHERE "owner_user_id" IS NULL
       OR "contact_name" IS NULL
       OR "phone" !~ '^\+?[1-9][0-9]{7,14}$'
       OR "priority" IS NULL OR "priority" NOT BETWEEN 1 AND 100
  ) THEN
    RAISE EXCEPTION 'existing SOS contacts require a valid owner, name, normalized phone, and priority';
  END IF;
END
$$;

ALTER TABLE "public"."sos_contacts"
  DROP CONSTRAINT "sos_contacts_member_id_fkey",
  DROP CONSTRAINT "sos_contacts_contact_user_id_fkey",
  ALTER COLUMN "member_id" DROP NOT NULL,
  ALTER COLUMN "contact_name" SET NOT NULL,
  ALTER COLUMN "priority" SET NOT NULL,
  ALTER COLUMN "is_active" SET NOT NULL,
  ALTER COLUMN "created_at" SET NOT NULL,
  ALTER COLUMN "priority" SET DEFAULT 1,
  ALTER COLUMN "is_active" SET DEFAULT true,
  ADD CONSTRAINT "sos_contacts_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "public"."profiles"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "sos_contacts_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "public"."family_members"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "sos_contacts_contact_user_id_fkey"
    FOREIGN KEY ("contact_user_id") REFERENCES "public"."profiles"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "sos_contacts_phone_format_check"
    CHECK ("phone" ~ '^\+?[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "sos_contacts_priority_check"
    CHECK ("priority" BETWEEN 1 AND 100),
  ADD CONSTRAINT "sos_contacts_not_self_check"
    CHECK ("contact_user_id" IS NULL OR "contact_user_id" <> "owner_user_id");

ALTER TABLE "public"."sos_contacts"
  ALTER COLUMN "owner_user_id" SET NOT NULL;

CREATE UNIQUE INDEX "sos_contacts_owner_phone_key"
  ON "public"."sos_contacts"("owner_user_id", "phone");
CREATE UNIQUE INDEX "sos_contacts_owner_linked_user_key"
  ON "public"."sos_contacts"("owner_user_id", "contact_user_id")
  WHERE "contact_user_id" IS NOT NULL;
CREATE INDEX "idx_sos_contacts_owner_priority"
  ON "public"."sos_contacts"("owner_user_id", "priority", "id");

ALTER TABLE "public"."sos_events"
  ADD COLUMN "actor_user_id" UUID,
  ADD COLUMN "client_request_id" UUID,
  ADD COLUMN "request_fingerprint" VARCHAR(64),
  ADD COLUMN "source_device_id" UUID,
  ADD COLUMN "source_location_id" UUID,
  ADD COLUMN "location_accuracy" DOUBLE PRECISION,
  ADD COLUMN "location_recorded_at" TIMESTAMPTZ(6),
  ADD COLUMN "resolved_at" TIMESTAMPTZ(6),
  ADD COLUMN "cancelled_at" TIMESTAMPTZ(6),
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "public"."sos_events" se
SET "actor_user_id" = fm."user_id",
    "client_request_id" = gen_random_uuid(),
    "request_fingerprint" = lpad(md5(se."id"::text), 64, '0'),
    "status" = CASE
      WHEN se."status" IN ('triggered', 'calling', 'active') THEN 'active'
      WHEN se."status" IN ('handled', 'resolved') THEN 'resolved'
      WHEN se."status" = 'cancelled' THEN 'cancelled'
      ELSE se."status"
    END,
    "triggered_at" = COALESCE(se."triggered_at", CURRENT_TIMESTAMP),
    "resolved_at" = CASE
      WHEN se."status" IN ('handled', 'resolved')
        THEN COALESCE(se."handled_at", se."triggered_at", CURRENT_TIMESTAMP)
      ELSE NULL
    END,
    "cancelled_at" = CASE
      WHEN se."status" = 'cancelled'
        THEN COALESCE(se."handled_at", se."triggered_at", CURRENT_TIMESTAMP)
      ELSE NULL
    END
FROM "public"."family_members" fm
WHERE fm."id" = se."member_id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "public"."sos_events"
    WHERE "actor_user_id" IS NULL
       OR "client_request_id" IS NULL
       OR "request_fingerprint" IS NULL
       OR "status" NOT IN ('active', 'resolved', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'existing SOS events require actor, idempotency, and valid lifecycle data';
  END IF;
END
$$;

ALTER TABLE "public"."sos_events"
  DROP CONSTRAINT "sos_events_family_id_fkey",
  DROP CONSTRAINT "sos_events_member_id_fkey",
  ALTER COLUMN "family_id" DROP NOT NULL,
  ALTER COLUMN "member_id" DROP NOT NULL,
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'active',
  ALTER COLUMN "triggered_at" SET NOT NULL,
  ALTER COLUMN "actor_user_id" SET NOT NULL,
  ALTER COLUMN "client_request_id" SET NOT NULL,
  ALTER COLUMN "request_fingerprint" SET NOT NULL,
  ADD CONSTRAINT "sos_events_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."profiles"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "sos_events_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "public"."families"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "sos_events_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "public"."family_members"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "sos_events_source_device_id_fkey"
    FOREIGN KEY ("source_device_id") REFERENCES "public"."devices"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "sos_events_source_location_id_fkey"
    FOREIGN KEY ("source_location_id") REFERENCES "public"."locations"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "sos_events_status_check"
    CHECK ("status" IN ('active', 'resolved', 'cancelled')),
  ADD CONSTRAINT "sos_events_state_timestamps_check"
    CHECK (
      ("status" = 'active' AND "resolved_at" IS NULL AND "cancelled_at" IS NULL)
      OR ("status" = 'resolved' AND "resolved_at" IS NOT NULL AND "cancelled_at" IS NULL)
      OR ("status" = 'cancelled' AND "resolved_at" IS NULL AND "cancelled_at" IS NOT NULL)
    ),
  ADD CONSTRAINT "sos_events_location_snapshot_check"
    CHECK (
      ("latitude" IS NULL AND "longitude" IS NULL
        AND "location_accuracy" IS NULL AND "location_recorded_at" IS NULL)
      OR ("latitude" BETWEEN -90 AND 90
        AND "longitude" BETWEEN -180 AND 180
        AND ("location_accuracy" IS NULL OR "location_accuracy" >= 0)
        AND "location_recorded_at" IS NOT NULL)
    ),
  ADD CONSTRAINT "sos_events_request_fingerprint_check"
    CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "sos_events_note_length_check"
    CHECK ("note" IS NULL OR char_length("note") <= 500);

CREATE UNIQUE INDEX "sos_events_actor_request_key"
  ON "public"."sos_events"("actor_user_id", "client_request_id");
CREATE UNIQUE INDEX "sos_events_one_active_actor_key"
  ON "public"."sos_events"("actor_user_id") WHERE "status" = 'active';
CREATE INDEX "idx_sos_events_actor_time_id"
  ON "public"."sos_events"("actor_user_id", "triggered_at" DESC, "id" DESC);

CREATE TABLE "public"."sos_recipients" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sos_event_id" UUID NOT NULL,
  "recipient_user_id" UUID NOT NULL,
  "source" VARCHAR(30) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sos_recipients_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sos_recipients_sos_event_id_fkey"
    FOREIGN KEY ("sos_event_id") REFERENCES "public"."sos_events"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "sos_recipients_recipient_user_id_fkey"
    FOREIGN KEY ("recipient_user_id") REFERENCES "public"."profiles"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "sos_recipients_source_check"
    CHECK ("source" IN ('actor', 'family', 'emergency_contact')),
  CONSTRAINT "sos_recipients_sos_event_id_recipient_user_id_key"
    UNIQUE ("sos_event_id", "recipient_user_id")
);

CREATE INDEX "idx_sos_recipients_user_event"
  ON "public"."sos_recipients"("recipient_user_id", "sos_event_id");

CREATE OR REPLACE FUNCTION "public"."enforce_sos_event_update"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD."actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
     OR OLD."client_request_id" IS DISTINCT FROM NEW."client_request_id"
     OR OLD."request_fingerprint" IS DISTINCT FROM NEW."request_fingerprint"
     OR OLD."family_id" IS DISTINCT FROM NEW."family_id"
     OR OLD."member_id" IS DISTINCT FROM NEW."member_id"
     OR OLD."source_device_id" IS DISTINCT FROM NEW."source_device_id"
     OR OLD."source_location_id" IS DISTINCT FROM NEW."source_location_id"
     OR OLD."latitude" IS DISTINCT FROM NEW."latitude"
     OR OLD."longitude" IS DISTINCT FROM NEW."longitude"
     OR OLD."location_accuracy" IS DISTINCT FROM NEW."location_accuracy"
     OR OLD."location_recorded_at" IS DISTINCT FROM NEW."location_recorded_at"
     OR OLD."triggered_at" IS DISTINCT FROM NEW."triggered_at"
     OR OLD."note" IS DISTINCT FROM NEW."note" THEN
    RAISE EXCEPTION 'SOS incident provenance and location snapshot are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" <> NEW."status"
     AND NOT (OLD."status" = 'active' AND NEW."status" IN ('resolved', 'cancelled')) THEN
    RAISE EXCEPTION 'invalid SOS state transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "sos_events_update_guard"
  BEFORE UPDATE ON "public"."sos_events"
  FOR EACH ROW EXECUTE FUNCTION "public"."enforce_sos_event_update"();

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_sos_source_check"
    CHECK ("notification_type" <> 'sos_alert'
       OR ("related_table" = 'sos_event' AND "related_id" IS NOT NULL));

ALTER TABLE "public"."sos_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."sos_contacts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."sos_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."sos_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."sos_recipients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."sos_recipients" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."sos_contacts" FROM anon, authenticated;
REVOKE ALL ON TABLE "public"."sos_events" FROM anon, authenticated;
REVOKE ALL ON TABLE "public"."sos_recipients" FROM anon, authenticated;
REVOKE ALL ON FUNCTION "public"."enforce_sos_event_update"() FROM PUBLIC, anon, authenticated;
