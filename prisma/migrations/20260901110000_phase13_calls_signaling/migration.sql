-- Phase 13: durable one-to-one call sessions and race-safe active participation.
-- Legacy CallLog rows require provenance review; the inspected deployed table was empty.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "public"."call_logs") THEN
    RAISE EXCEPTION 'Phase 13 requires manual legacy call provenance review';
  END IF;
END
$$;

ALTER TABLE "public"."call_logs"
  ADD COLUMN "conversation_id" UUID,
  ADD COLUMN "client_request_id" UUID,
  ADD COLUMN "request_fingerprint" VARCHAR(64),
  ADD COLUMN "expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "accepted_at" TIMESTAMPTZ(6),
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now();

ALTER TABLE "public"."call_logs"
  DROP CONSTRAINT "call_logs_family_id_fkey",
  DROP CONSTRAINT "call_logs_caller_id_fkey",
  DROP CONSTRAINT "call_logs_receiver_id_fkey",
  ALTER COLUMN "conversation_id" SET NOT NULL,
  ALTER COLUMN "client_request_id" SET NOT NULL,
  ALTER COLUMN "request_fingerprint" SET NOT NULL,
  ALTER COLUMN "call_type" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'ringing',
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "started_at" SET DEFAULT now(),
  ALTER COLUMN "started_at" SET NOT NULL,
  ALTER COLUMN "expires_at" SET NOT NULL,
  ADD CONSTRAINT "call_logs_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "public"."families"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "call_logs_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "call_logs_caller_id_fkey"
    FOREIGN KEY ("caller_id") REFERENCES "public"."profiles"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "call_logs_receiver_id_fkey"
    FOREIGN KEY ("receiver_id") REFERENCES "public"."profiles"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "call_logs_participants_check" CHECK ("caller_id" <> "receiver_id"),
  ADD CONSTRAINT "call_logs_type_check" CHECK ("call_type" IN ('voice', 'video')),
  ADD CONSTRAINT "call_logs_status_check"
    CHECK ("status" IN ('ringing', 'accepted', 'rejected', 'cancelled', 'missed', 'ended')),
  ADD CONSTRAINT "call_logs_fingerprint_check"
    CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "call_logs_expiry_check" CHECK ("expires_at" > "started_at"),
  ADD CONSTRAINT "call_logs_duration_deferred_check" CHECK ("duration_seconds" IS NULL),
  ADD CONSTRAINT "call_logs_lifecycle_time_check" CHECK (
    ("status" = 'ringing' AND "accepted_at" IS NULL AND "ended_at" IS NULL)
    OR ("status" = 'accepted' AND "accepted_at" IS NOT NULL AND "ended_at" IS NULL)
    OR ("status" = 'ended' AND "accepted_at" IS NOT NULL AND "ended_at" IS NOT NULL)
    OR ("status" IN ('rejected', 'cancelled', 'missed')
        AND "accepted_at" IS NULL AND "ended_at" IS NOT NULL)
  );

DROP INDEX IF EXISTS "public"."idx_call_logs_caller_time";
DROP INDEX IF EXISTS "public"."idx_call_logs_receiver_time";
CREATE UNIQUE INDEX "call_logs_caller_request_key"
  ON "public"."call_logs"("caller_id", "client_request_id");
CREATE INDEX "idx_call_logs_caller_time"
  ON "public"."call_logs"("caller_id", "started_at" DESC, "id" DESC);
CREATE INDEX "idx_call_logs_receiver_time"
  ON "public"."call_logs"("receiver_id", "started_at" DESC, "id" DESC);
CREATE INDEX "idx_call_logs_conversation_time"
  ON "public"."call_logs"("conversation_id", "started_at" DESC, "id" DESC);
CREATE INDEX "idx_call_logs_expiry"
  ON "public"."call_logs"("status", "expires_at");

CREATE TABLE "public"."call_active_participants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "call_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "call_active_participants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "call_active_participants_call_id_fkey"
    FOREIGN KEY ("call_id") REFERENCES "public"."call_logs"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "call_active_participants_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "call_active_participants_user_key"
  ON "public"."call_active_participants"("user_id");
CREATE UNIQUE INDEX "call_active_participants_call_user_key"
  ON "public"."call_active_participants"("call_id", "user_id");
CREATE INDEX "idx_call_active_participants_call"
  ON "public"."call_active_participants"("call_id");

CREATE OR REPLACE FUNCTION "public"."enforce_call_conversation_participants"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "public"."conversations" c
    JOIN "public"."families" f ON f."id" = c."family_id"
    WHERE c."id" = NEW."conversation_id"
      AND c."family_id" = NEW."family_id"
      AND c."conversation_type" = 'direct'
      AND f."status" = 'active'
      AND (SELECT count(*) FROM "public"."conversation_members" cm
           JOIN "public"."family_members" fm
             ON fm."family_id" = c."family_id" AND fm."user_id" = cm."user_id"
           WHERE cm."conversation_id" = c."id" AND cm."is_active"
             AND fm."status" = 'accepted') = 2
      AND EXISTS (SELECT 1 FROM "public"."conversation_members" cm
                  JOIN "public"."family_members" fm
                    ON fm."family_id" = c."family_id" AND fm."user_id" = cm."user_id"
                  WHERE cm."conversation_id" = c."id" AND cm."user_id" = NEW."caller_id"
                    AND cm."is_active" AND fm."status" = 'accepted')
      AND EXISTS (SELECT 1 FROM "public"."conversation_members" cm
                  JOIN "public"."family_members" fm
                    ON fm."family_id" = c."family_id" AND fm."user_id" = cm."user_id"
                  WHERE cm."conversation_id" = c."id" AND cm."user_id" = NEW."receiver_id"
                    AND cm."is_active" AND fm."status" = 'accepted')
  ) THEN
    RAISE EXCEPTION 'Call participants must match one current direct Conversation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "trg_call_conversation_participants"
BEFORE INSERT ON "public"."call_logs"
FOR EACH ROW EXECUTE FUNCTION "public"."enforce_call_conversation_participants"();

CREATE OR REPLACE FUNCTION "public"."enforce_call_transition"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW."family_id", NEW."conversation_id", NEW."caller_id", NEW."receiver_id",
      NEW."client_request_id", NEW."request_fingerprint", NEW."call_type", NEW."started_at", NEW."expires_at")
     IS DISTINCT FROM
     (OLD."family_id", OLD."conversation_id", OLD."caller_id", OLD."receiver_id",
      OLD."client_request_id", OLD."request_fingerprint", OLD."call_type", OLD."started_at", OLD."expires_at") THEN
    RAISE EXCEPTION 'Call provenance is immutable';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'ringing' AND NEW."status" IN ('accepted', 'rejected', 'cancelled', 'missed'))
    OR (OLD."status" = 'accepted' AND NEW."status" = 'ended')
  ) THEN
    RAISE EXCEPTION 'Invalid Call state transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "trg_call_transition"
BEFORE UPDATE ON "public"."call_logs"
FOR EACH ROW EXECUTE FUNCTION "public"."enforce_call_transition"();

CREATE OR REPLACE FUNCTION "public"."enforce_active_call_participant"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "public"."call_logs" c
    WHERE c."id" = NEW."call_id" AND c."status" IN ('ringing', 'accepted')
      AND NEW."user_id" IN (c."caller_id", c."receiver_id")
  ) THEN
    RAISE EXCEPTION 'Active Call participant must belong to an active Call';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "trg_active_call_participant"
BEFORE INSERT OR UPDATE ON "public"."call_active_participants"
FOR EACH ROW EXECUTE FUNCTION "public"."enforce_active_call_participant"();

CREATE OR REPLACE FUNCTION "public"."release_terminal_call_participants"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW."status" IN ('rejected', 'cancelled', 'missed', 'ended')
     AND OLD."status" <> NEW."status" THEN
    DELETE FROM "public"."call_active_participants" WHERE "call_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "trg_release_terminal_call_participants"
AFTER UPDATE OF "status" ON "public"."call_logs"
FOR EACH ROW EXECUTE FUNCTION "public"."release_terminal_call_participants"();

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_call_source_check"
    CHECK ("notification_type" <> 'call_incoming'
       OR ("related_table" = 'call_log' AND "related_id" IS NOT NULL));

CREATE OR REPLACE FUNCTION "public"."enforce_call_notification_source"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW."notification_type" = 'call_incoming' AND NOT EXISTS (
    SELECT 1 FROM "public"."call_logs" c
    WHERE c."id" = NEW."related_id"
      AND c."family_id" = NEW."family_id"
      AND c."caller_id" = NEW."sender_user_id"
      AND c."receiver_id" = NEW."recipient_user_id"
  ) THEN
    RAISE EXCEPTION 'Incoming Call Notification must match its Call';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "trg_call_notification_source"
BEFORE INSERT OR UPDATE OF "notification_type", "related_table", "related_id",
  "family_id", "sender_user_id", "recipient_user_id"
ON "public"."notifications"
FOR EACH ROW EXECUTE FUNCTION "public"."enforce_call_notification_source"();

ALTER TABLE "public"."call_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."call_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."call_active_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."call_active_participants" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."call_logs" FROM anon, authenticated;
REVOKE ALL ON TABLE "public"."call_active_participants" FROM anon, authenticated;
REVOKE ALL ON FUNCTION "public"."enforce_call_conversation_participants"() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION "public"."enforce_call_transition"() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION "public"."enforce_active_call_participant"() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION "public"."release_terminal_call_participants"() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION "public"."enforce_call_notification_source"() FROM PUBLIC, anon, authenticated;
