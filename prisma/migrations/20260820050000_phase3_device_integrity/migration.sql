-- Phase 3 device identity and lifecycle integrity. The existing devices table
-- and all foreign-key relationships are preserved.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "public"."devices"
    WHERE "device_identifier" IS NULL
       OR "device_identifier" !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'devices.device_identifier must contain a UUID before Phase 3 migration';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "public"."devices"
    WHERE "device_type" IS NULL
       OR "device_type" NOT IN ('android', 'ios', 'web', 'other')
  ) THEN
    RAISE EXCEPTION 'devices.device_type contains unsupported values';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "public"."devices"
    WHERE "battery_level" IS NOT NULL
      AND ("battery_level" < 0 OR "battery_level" > 100)
  ) THEN
    RAISE EXCEPTION 'devices.battery_level must be between 0 and 100';
  END IF;

  IF EXISTS (
    SELECT "device_identifier"
    FROM "public"."devices"
    GROUP BY "device_identifier"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate devices.device_identifier values must be resolved';
  END IF;

  IF EXISTS (
    SELECT "fcm_token"
    FROM "public"."devices"
    WHERE "fcm_token" IS NOT NULL
    GROUP BY "fcm_token"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate non-null devices.fcm_token values must be resolved';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "public"."devices"
    WHERE "fcm_token" IS NOT NULL
      AND (
        octet_length("fcm_token") < 16
        OR octet_length("fcm_token") > 1024
        OR "fcm_token" !~ '^[!-~]+$'
      )
  ) THEN
    RAISE EXCEPTION 'devices.fcm_token contains unsupported values';
  END IF;
END
$$;

UPDATE "public"."devices"
SET "last_seen_at" = COALESCE("last_seen_at", "created_at", CURRENT_TIMESTAMP),
    "created_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
    "is_active" = COALESCE("is_active", true);

ALTER TABLE "public"."devices"
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "device_identifier" SET NOT NULL,
  ALTER COLUMN "device_type" SET NOT NULL,
  ALTER COLUMN "is_active" SET NOT NULL,
  ALTER COLUMN "last_seen_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "last_seen_at" SET NOT NULL,
  ALTER COLUMN "created_at" SET NOT NULL,
  ADD CONSTRAINT "devices_installation_id_uuid"
    CHECK ("device_identifier" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  ADD CONSTRAINT "devices_platform_supported"
    CHECK ("device_type" IN ('android', 'ios', 'web', 'other')),
  ADD CONSTRAINT "devices_battery_level_range"
    CHECK ("battery_level" IS NULL OR "battery_level" BETWEEN 0 AND 100),
  ADD CONSTRAINT "devices_fcm_token_format"
    CHECK (
      "fcm_token" IS NULL OR (
        octet_length("fcm_token") BETWEEN 16 AND 1024
        AND "fcm_token" ~ '^[!-~]+$'
      )
    );

CREATE UNIQUE INDEX "devices_installation_id_key"
  ON "public"."devices" ("device_identifier");

CREATE UNIQUE INDEX "devices_fcm_token_key"
  ON "public"."devices" ("fcm_token");
