-- Phase 4: make location history authoritative per user/device and maintain one
-- current-location projection per user. Existing tables and RLS posture remain.

ALTER TABLE "public"."locations"
  ADD COLUMN "user_id" UUID,
  ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "public"."locations" l
SET "user_id" = fm."user_id",
    "created_at" = l."recorded_at"
FROM "public"."family_members" fm
WHERE fm."id" = l."member_id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "public"."locations"
    WHERE "user_id" IS NULL OR "device_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'existing location rows require resolvable user_id and device_id';
  END IF;
END
$$;

ALTER TABLE "public"."locations"
  DROP CONSTRAINT "locations_member_id_fkey",
  DROP CONSTRAINT "locations_device_id_fkey",
  ALTER COLUMN "user_id" SET NOT NULL,
  ALTER COLUMN "member_id" DROP NOT NULL,
  ALTER COLUMN "device_id" SET NOT NULL,
  ADD CONSTRAINT "locations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "locations_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "public"."family_members"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "locations_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "locations_latitude_range"
    CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "locations_longitude_range"
    CHECK ("longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "locations_accuracy_nonnegative"
    CHECK ("accuracy" IS NULL OR "accuracy" >= 0),
  ADD CONSTRAINT "locations_speed_nonnegative"
    CHECK ("speed" IS NULL OR "speed" >= 0),
  ADD CONSTRAINT "locations_heading_range"
    CHECK ("heading" IS NULL OR ("heading" >= 0 AND "heading" < 360)),
  ADD CONSTRAINT "locations_battery_range"
    CHECK ("battery_level" IS NULL OR "battery_level" BETWEEN 0 AND 100);

CREATE INDEX "idx_locations_user_time_id"
  ON "public"."locations" ("user_id", "recorded_at" DESC, "id" DESC);

CREATE INDEX "idx_locations_device_time"
  ON "public"."locations" ("device_id", "recorded_at" DESC);

ALTER TABLE "public"."current_locations"
  ADD COLUMN "user_id" UUID,
  ADD COLUMN "device_id" UUID,
  ADD COLUMN "location_id" UUID,
  ADD COLUMN "recorded_at" TIMESTAMPTZ(6);

UPDATE "public"."current_locations" c
SET "user_id" = fm."user_id"
FROM "public"."family_members" fm
WHERE fm."id" = c."member_id";

UPDATE "public"."current_locations" c
SET "location_id" = (
      SELECT l."id" FROM "public"."locations" l
      WHERE l."member_id" = c."member_id"
      ORDER BY l."recorded_at" DESC, l."id" DESC LIMIT 1
    ),
    "device_id" = (
      SELECT l."device_id" FROM "public"."locations" l
      WHERE l."member_id" = c."member_id"
      ORDER BY l."recorded_at" DESC, l."id" DESC LIMIT 1
    ),
    "recorded_at" = COALESCE((
      SELECT l."recorded_at" FROM "public"."locations" l
      WHERE l."member_id" = c."member_id"
      ORDER BY l."recorded_at" DESC, l."id" DESC LIMIT 1
    ), c."updated_at");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "public"."current_locations"
    WHERE "user_id" IS NULL OR "device_id" IS NULL
       OR "location_id" IS NULL OR "recorded_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'existing current location rows require matching device history';
  END IF;

  IF EXISTS (
    SELECT "user_id" FROM "public"."current_locations"
    GROUP BY "user_id" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'multiple current location rows exist for one user';
  END IF;
END
$$;

ALTER TABLE "public"."current_locations"
  DROP CONSTRAINT "current_locations_pkey",
  DROP CONSTRAINT "current_locations_member_id_fkey",
  ALTER COLUMN "member_id" DROP NOT NULL,
  ALTER COLUMN "user_id" SET NOT NULL,
  ALTER COLUMN "device_id" SET NOT NULL,
  ALTER COLUMN "location_id" SET NOT NULL,
  ALTER COLUMN "recorded_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET NOT NULL,
  ADD CONSTRAINT "current_locations_pkey" PRIMARY KEY ("user_id"),
  ADD CONSTRAINT "current_locations_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "public"."family_members"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "current_locations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "current_locations_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "current_locations_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "current_locations_latitude_range"
    CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "current_locations_longitude_range"
    CHECK ("longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "current_locations_accuracy_nonnegative"
    CHECK ("accuracy" IS NULL OR "accuracy" >= 0),
  ADD CONSTRAINT "current_locations_battery_range"
    CHECK ("battery_level" IS NULL OR "battery_level" BETWEEN 0 AND 100);

CREATE UNIQUE INDEX "current_locations_location_id_key"
  ON "public"."current_locations" ("location_id");

CREATE INDEX "idx_current_locations_device"
  ON "public"."current_locations" ("device_id");
