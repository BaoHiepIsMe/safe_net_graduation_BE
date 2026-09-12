-- Phase 5: preserve the existing circular geofence tables while adding durable,
-- concurrency-safe transition state and database-enforced family provenance.

ALTER TABLE "public"."geofences"
  ALTER COLUMN "is_active" SET NOT NULL,
  ALTER COLUMN "created_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET NOT NULL,
  ADD CONSTRAINT "geofences_latitude_range"
    CHECK ("center_latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "geofences_longitude_range"
    CHECK ("center_longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "geofences_radius_range"
    CHECK ("radius_meters" BETWEEN 1 AND 100000);

ALTER TABLE "public"."geofence_members"
  ADD COLUMN "family_id" UUID;

UPDATE "public"."geofence_members" gm
SET "family_id" = g."family_id"
FROM "public"."geofences" g
WHERE g."id" = gm."geofence_id";

ALTER TABLE "public"."geofence_members"
  ALTER COLUMN "family_id" SET NOT NULL,
  ALTER COLUMN "notify_on_enter" SET NOT NULL,
  ALTER COLUMN "notify_on_exit" SET NOT NULL,
  ADD CONSTRAINT "geofence_members_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "public"."families"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE INDEX "idx_geofence_members_family"
  ON "public"."geofence_members" ("family_id");

ALTER TABLE "public"."geofence_events"
  ADD COLUMN "location_id" UUID,
  ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "public"."geofence_events"
SET "detected_at" = CURRENT_TIMESTAMP
WHERE "detected_at" IS NULL;

ALTER TABLE "public"."geofence_events"
  ALTER COLUMN "detected_at" SET NOT NULL,
  ADD CONSTRAINT "geofence_events_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "geofence_events_type_valid"
    CHECK ("event_type" IN ('enter', 'exit'));

CREATE UNIQUE INDEX "geofence_events_geofence_member_location_key"
  ON "public"."geofence_events" ("geofence_id", "member_id", "location_id");

CREATE INDEX "idx_geofence_events_geofence_time"
  ON "public"."geofence_events" ("geofence_id", "detected_at" DESC);

CREATE TABLE "public"."geofence_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "family_id" UUID NOT NULL,
  "geofence_id" UUID NOT NULL,
  "member_id" UUID NOT NULL,
  "is_inside" BOOLEAN NOT NULL,
  "last_location_id" UUID NOT NULL,
  "last_recorded_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "geofence_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "geofence_states_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "public"."families"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "geofence_states_geofence_id_fkey"
    FOREIGN KEY ("geofence_id") REFERENCES "public"."geofences"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "geofence_states_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "public"."family_members"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "geofence_states_last_location_id_fkey"
    FOREIGN KEY ("last_location_id") REFERENCES "public"."locations"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "geofence_states_geofence_id_member_id_key"
    UNIQUE ("geofence_id", "member_id")
);

CREATE INDEX "idx_geofence_states_member"
  ON "public"."geofence_states" ("member_id");

CREATE OR REPLACE FUNCTION "public"."enforce_geofence_family_consistency"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  zone_family UUID;
  member_family UUID;
  member_user UUID;
  location_user UUID;
BEGIN
  SELECT "family_id" INTO zone_family
  FROM "public"."geofences" WHERE "id" = NEW."geofence_id";

  SELECT "family_id", "user_id" INTO member_family, member_user
  FROM "public"."family_members" WHERE "id" = NEW."member_id";

  IF zone_family IS NULL OR member_family IS NULL
     OR NEW."family_id" <> zone_family
     OR NEW."family_id" <> member_family THEN
    RAISE EXCEPTION 'geofence, member, and family must belong to the same family'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'geofence_events' AND NEW."location_id" IS NOT NULL THEN
    SELECT "user_id" INTO location_user
    FROM "public"."locations" WHERE "id" = NEW."location_id";
  ELSIF TG_TABLE_NAME = 'geofence_states' THEN
    SELECT "user_id" INTO location_user
    FROM "public"."locations" WHERE "id" = NEW."last_location_id";
  ELSE
    RETURN NEW;
  END IF;

  IF location_user IS NULL OR location_user <> member_user THEN
    RAISE EXCEPTION 'geofence location must belong to the assigned member user'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "geofence_members_family_consistency"
  BEFORE INSERT OR UPDATE ON "public"."geofence_members"
  FOR EACH ROW EXECUTE FUNCTION "public"."enforce_geofence_family_consistency"();

CREATE TRIGGER "geofence_events_family_consistency"
  BEFORE INSERT OR UPDATE ON "public"."geofence_events"
  FOR EACH ROW EXECUTE FUNCTION "public"."enforce_geofence_family_consistency"();

CREATE TRIGGER "geofence_states_family_consistency"
  BEFORE INSERT OR UPDATE ON "public"."geofence_states"
  FOR EACH ROW EXECUTE FUNCTION "public"."enforce_geofence_family_consistency"();

ALTER TABLE "public"."geofence_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."geofence_states" FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "public"."geofence_states" FROM anon, authenticated;
REVOKE ALL ON FUNCTION "public"."enforce_geofence_family_consistency"() FROM PUBLIC, anon, authenticated;
