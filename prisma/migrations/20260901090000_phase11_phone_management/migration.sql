-- Phase 11: durable, family-scoped phone management.
-- Forward-only. Existing legacy rows are preserved; deployment stops rather
-- than guessing missing device/family provenance.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "public"."phone_commands") THEN
    RAISE EXCEPTION 'Phase 11 requires legacy phone_commands provenance review';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "public"."phone_usage_logs"
    WHERE "device_id" IS NULL OR "app_package" IS NULL
       OR "end_time" IS NULL OR "duration_seconds" IS NULL
  ) THEN
    RAISE EXCEPTION 'Phase 11 requires legacy phone_usage_logs provenance review';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "public"."phone_rules"
    GROUP BY "family_id", "member_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Phase 11 requires duplicate phone_rules review';
  END IF;
END
$$;

ALTER TABLE "public"."phone_usage_logs"
  ADD COLUMN "client_record_id" UUID,
  ADD COLUMN "request_fingerprint" VARCHAR(64);

UPDATE "public"."phone_usage_logs"
SET "client_record_id" = gen_random_uuid(),
    "request_fingerprint" = lpad(md5("id"::text), 64, '0'),
    "created_at" = COALESCE("created_at", now());

ALTER TABLE "public"."phone_usage_logs"
  DROP CONSTRAINT "phone_usage_logs_device_id_fkey",
  DROP CONSTRAINT "phone_usage_logs_member_id_fkey",
  ALTER COLUMN "device_id" SET NOT NULL,
  ALTER COLUMN "client_record_id" SET NOT NULL,
  ALTER COLUMN "request_fingerprint" SET NOT NULL,
  ALTER COLUMN "app_package" SET NOT NULL,
  ALTER COLUMN "end_time" SET NOT NULL,
  ALTER COLUMN "duration_seconds" SET NOT NULL,
  ALTER COLUMN "created_at" SET DEFAULT now(),
  ALTER COLUMN "created_at" SET NOT NULL,
  ADD CONSTRAINT "phone_usage_logs_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "phone_usage_logs_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "public"."family_members"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "phone_usage_logs_time_check"
    CHECK ("start_time" <= "end_time"),
  ADD CONSTRAINT "phone_usage_logs_duration_check"
    CHECK ("duration_seconds" >= 0 AND "duration_seconds" <= 86400),
  ADD CONSTRAINT "phone_usage_logs_package_check"
    CHECK (length(btrim("app_package")) BETWEEN 1 AND 150),
  ADD CONSTRAINT "phone_usage_logs_name_check"
    CHECK ("app_name" IS NULL OR length(btrim("app_name")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "phone_usage_logs_fingerprint_check"
    CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX "phone_usage_device_record_key"
  ON "public"."phone_usage_logs"("device_id", "client_record_id");
CREATE INDEX "idx_phone_usage_device_time"
  ON "public"."phone_usage_logs"("device_id", "start_time" DESC, "id" DESC);
DROP INDEX IF EXISTS "public"."idx_phone_usage_member_time";
CREATE INDEX "idx_phone_usage_member_time"
  ON "public"."phone_usage_logs"("member_id", "start_time" DESC, "id" DESC);

UPDATE "public"."phone_rules"
SET "is_active" = COALESCE("is_active", true),
    "created_at" = COALESCE("created_at", now()),
    "updated_at" = COALESCE("updated_at", now());

ALTER TABLE "public"."phone_rules"
  DROP CONSTRAINT "phone_rules_family_id_fkey",
  DROP CONSTRAINT "phone_rules_member_id_fkey",
  DROP CONSTRAINT "phone_rules_created_by_fkey",
  ALTER COLUMN "is_active" SET DEFAULT true,
  ALTER COLUMN "is_active" SET NOT NULL,
  ALTER COLUMN "created_at" SET DEFAULT now(),
  ALTER COLUMN "created_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET DEFAULT now(),
  ALTER COLUMN "updated_at" SET NOT NULL,
  ADD CONSTRAINT "phone_rules_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "public"."families"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "phone_rules_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "public"."family_members"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "phone_rules_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "phone_rules_daily_limit_check"
    CHECK ("daily_limit_minutes" IS NULL OR "daily_limit_minutes" BETWEEN 1 AND 1440),
  ADD CONSTRAINT "phone_rules_bedtime_pair_check"
    CHECK (("bedtime_start" IS NULL) = ("bedtime_end" IS NULL)),
  ADD CONSTRAINT "phone_rules_configuration_check"
    CHECK ("daily_limit_minutes" IS NOT NULL OR "bedtime_start" IS NOT NULL);

CREATE UNIQUE INDEX "phone_rules_family_member_key"
  ON "public"."phone_rules"("family_id", "member_id");
CREATE INDEX "idx_phone_rules_member_active"
  ON "public"."phone_rules"("member_id", "is_active");

ALTER TABLE "public"."phone_commands"
  ADD COLUMN "family_id" UUID,
  ADD COLUMN "member_id" UUID,
  ADD COLUMN "client_request_id" UUID,
  ADD COLUMN "request_fingerprint" VARCHAR(64),
  ADD COLUMN "result_code" VARCHAR(50),
  ADD COLUMN "result_message" VARCHAR(300),
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  ADD COLUMN "sent_at" TIMESTAMPTZ(6);

ALTER TABLE "public"."phone_commands"
  DROP CONSTRAINT "phone_commands_target_device_id_fkey",
  DROP CONSTRAINT "phone_commands_created_by_fkey",
  ALTER COLUMN "family_id" SET NOT NULL,
  ALTER COLUMN "member_id" SET NOT NULL,
  ALTER COLUMN "client_request_id" SET NOT NULL,
  ALTER COLUMN "request_fingerprint" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'pending',
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "created_at" SET DEFAULT now(),
  ALTER COLUMN "created_at" SET NOT NULL,
  ADD CONSTRAINT "phone_commands_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "public"."families"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "phone_commands_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "public"."family_members"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "phone_commands_target_device_id_fkey"
    FOREIGN KEY ("target_device_id") REFERENCES "public"."devices"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "phone_commands_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "phone_commands_type_check"
    CHECK ("command_type" IN ('lock', 'ring', 'warning')),
  ADD CONSTRAINT "phone_commands_status_check"
    CHECK ("status" IN ('pending', 'sent', 'completed', 'failed')),
  ADD CONSTRAINT "phone_commands_fingerprint_check"
    CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "phone_commands_result_check"
    CHECK (
      ("status" IN ('pending', 'sent') AND "executed_at" IS NULL
        AND "result_code" IS NULL AND "result_message" IS NULL)
      OR ("status" = 'completed' AND "executed_at" IS NOT NULL)
      OR ("status" = 'failed' AND "executed_at" IS NOT NULL
        AND "result_code" IS NOT NULL)
    ),
  ADD CONSTRAINT "phone_commands_sent_check"
    CHECK ("status" <> 'sent' OR "sent_at" IS NOT NULL);

CREATE UNIQUE INDEX "phone_commands_creator_request_key"
  ON "public"."phone_commands"("created_by", "client_request_id");
CREATE INDEX "idx_phone_commands_device_status_time"
  ON "public"."phone_commands"("target_device_id", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "idx_phone_commands_family_member_time"
  ON "public"."phone_commands"("family_id", "member_id", "created_at" DESC, "id" DESC);

CREATE OR REPLACE FUNCTION "public"."enforce_phone_target_binding"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  target_user UUID;
  target_family UUID;
  target_role TEXT;
  target_status TEXT;
  family_status TEXT;
  device_user UUID;
  device_active BOOLEAN;
  expected_family UUID;
  expected_device UUID;
BEGIN
  SELECT fm."user_id", fm."family_id", fm."role", fm."status", f."status"
  INTO target_user, target_family, target_role, target_status, family_status
  FROM "public"."family_members" fm
  JOIN "public"."families" f ON f."id" = fm."family_id"
  WHERE fm."id" = NEW."member_id";

  expected_family := COALESCE(
    (to_jsonb(NEW) ->> 'family_id')::UUID,
    target_family
  );

  IF target_user IS NULL OR target_family <> expected_family
     OR target_role <> 'child' OR target_status <> 'accepted'
     OR family_status <> 'active' THEN
    RAISE EXCEPTION 'Phone target must be an accepted child in the active family';
  END IF;

  IF TG_TABLE_NAME IN ('phone_usage_logs', 'phone_commands') THEN
    expected_device := COALESCE(
      (to_jsonb(NEW) ->> 'device_id')::UUID,
      (to_jsonb(NEW) ->> 'target_device_id')::UUID
    );
    SELECT "user_id", "is_active" INTO device_user, device_active
    FROM "public"."devices"
    WHERE "id" = expected_device;
    IF device_user IS NULL OR device_user <> target_user OR NOT device_active THEN
      RAISE EXCEPTION 'Phone target device must be active and owned by the target child';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_phone_usage_target_binding"
BEFORE INSERT OR UPDATE OF "member_id", "device_id"
ON "public"."phone_usage_logs"
FOR EACH ROW EXECUTE FUNCTION "public"."enforce_phone_target_binding"();

CREATE TRIGGER "trg_phone_rule_target_binding"
BEFORE INSERT OR UPDATE OF "family_id", "member_id"
ON "public"."phone_rules"
FOR EACH ROW EXECUTE FUNCTION "public"."enforce_phone_target_binding"();

CREATE TRIGGER "trg_phone_command_target_binding"
BEFORE INSERT OR UPDATE OF "family_id", "member_id", "target_device_id"
ON "public"."phone_commands"
FOR EACH ROW EXECUTE FUNCTION "public"."enforce_phone_target_binding"();

CREATE OR REPLACE FUNCTION "public"."enforce_phone_command_transition"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD."family_id" IS DISTINCT FROM NEW."family_id"
     OR OLD."member_id" IS DISTINCT FROM NEW."member_id"
     OR OLD."target_device_id" IS DISTINCT FROM NEW."target_device_id"
     OR OLD."created_by" IS DISTINCT FROM NEW."created_by"
     OR OLD."client_request_id" IS DISTINCT FROM NEW."client_request_id"
     OR OLD."request_fingerprint" IS DISTINCT FROM NEW."request_fingerprint"
     OR OLD."command_type" IS DISTINCT FROM NEW."command_type"
     OR OLD."command_payload" IS DISTINCT FROM NEW."command_payload"
     OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Phone command provenance is immutable';
  END IF;
  IF OLD."status" <> NEW."status" AND NOT (
    OLD."status" = 'pending' AND NEW."status" IN ('sent', 'completed', 'failed')
    OR OLD."status" = 'sent' AND NEW."status" IN ('completed', 'failed')
  ) THEN
    RAISE EXCEPTION 'Invalid phone command state transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_phone_command_transition"
BEFORE UPDATE ON "public"."phone_commands"
FOR EACH ROW EXECUTE FUNCTION "public"."enforce_phone_command_transition"();

ALTER TABLE "public"."phone_usage_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."phone_usage_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."phone_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."phone_rules" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."phone_commands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."phone_commands" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."phone_usage_logs" FROM anon, authenticated;
REVOKE ALL ON TABLE "public"."phone_rules" FROM anon, authenticated;
REVOKE ALL ON TABLE "public"."phone_commands" FROM anon, authenticated;
REVOKE ALL ON FUNCTION "public"."enforce_phone_target_binding"() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION "public"."enforce_phone_command_transition"() FROM PUBLIC, anon, authenticated;
