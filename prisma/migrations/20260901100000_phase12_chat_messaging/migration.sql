-- Phase 12: family-scoped text chat, durable idempotency and per-user read cursors.
-- Legacy tables are preserved; migration stops instead of guessing provenance.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "public"."conversations")
     OR EXISTS (SELECT 1 FROM "public"."conversation_members")
     OR EXISTS (SELECT 1 FROM "public"."messages") THEN
    RAISE EXCEPTION 'Phase 12 requires manual legacy chat provenance review';
  END IF;
END
$$;

ALTER TABLE "public"."conversations"
  ADD COLUMN "direct_key" VARCHAR(73),
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now();

ALTER TABLE "public"."conversations"
  DROP CONSTRAINT "conversations_family_id_fkey",
  ALTER COLUMN "conversation_type" SET DEFAULT 'direct',
  ALTER COLUMN "conversation_type" SET NOT NULL,
  ALTER COLUMN "created_at" SET DEFAULT now(),
  ALTER COLUMN "created_at" SET NOT NULL,
  ADD CONSTRAINT "conversations_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "public"."families"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "conversations_type_check"
    CHECK ("conversation_type" IN ('direct', 'group')),
  ADD CONSTRAINT "conversations_direct_key_check"
    CHECK (("conversation_type" = 'direct' AND "direct_key" IS NOT NULL)
       OR ("conversation_type" = 'group' AND "direct_key" IS NULL)),
  ADD CONSTRAINT "conversations_title_check"
    CHECK ("title" IS NULL OR length(btrim("title")) BETWEEN 1 AND 100);

DROP INDEX IF EXISTS "public"."idx_conversations_family";
CREATE UNIQUE INDEX "conversations_family_direct_key"
  ON "public"."conversations"("family_id", "direct_key");
CREATE INDEX "idx_conversations_family_type"
  ON "public"."conversations"("family_id", "conversation_type");

ALTER TABLE "public"."conversation_members"
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "removed_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_read_message_id" UUID,
  ADD COLUMN "last_read_message_created_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_read_at" TIMESTAMPTZ(6);

ALTER TABLE "public"."conversation_members"
  DROP CONSTRAINT "conversation_members_conversation_id_fkey",
  DROP CONSTRAINT "conversation_members_user_id_fkey",
  ALTER COLUMN "joined_at" SET DEFAULT now(),
  ALTER COLUMN "joined_at" SET NOT NULL,
  ADD CONSTRAINT "conversation_members_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "conversation_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "conversation_members_lifecycle_check"
    CHECK (("is_active" AND "removed_at" IS NULL)
       OR (NOT "is_active" AND "removed_at" IS NOT NULL)),
  ADD CONSTRAINT "conversation_members_read_cursor_pair_check"
    CHECK (("last_read_message_id" IS NULL
         AND "last_read_message_created_at" IS NULL)
       OR ("last_read_message_id" IS NOT NULL
         AND "last_read_message_created_at" IS NOT NULL));

ALTER TABLE "public"."messages"
  ADD COLUMN "client_message_id" UUID,
  ADD COLUMN "request_fingerprint" VARCHAR(64);

ALTER TABLE "public"."messages"
  DROP CONSTRAINT "messages_conversation_id_fkey",
  DROP CONSTRAINT "messages_sender_id_fkey",
  ALTER COLUMN "client_message_id" SET NOT NULL,
  ALTER COLUMN "request_fingerprint" SET NOT NULL,
  ALTER COLUMN "message_type" SET DEFAULT 'text',
  ALTER COLUMN "message_type" SET NOT NULL,
  ALTER COLUMN "content" SET NOT NULL,
  ALTER COLUMN "created_at" SET DEFAULT now(),
  ALTER COLUMN "created_at" SET NOT NULL,
  ADD CONSTRAINT "messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "messages_sender_id_fkey"
    FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "messages_type_check" CHECK ("message_type" = 'text'),
  ADD CONSTRAINT "messages_text_check"
    CHECK (length(btrim("content")) BETWEEN 1 AND 4000),
  ADD CONSTRAINT "messages_media_deferred_check" CHECK ("media_url" IS NULL),
  ADD CONSTRAINT "messages_fingerprint_check"
    CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$');

DROP INDEX IF EXISTS "public"."idx_messages_conversation_time";
CREATE UNIQUE INDEX "messages_conversation_sender_client_key"
  ON "public"."messages"("conversation_id", "sender_id", "client_message_id");
CREATE INDEX "idx_messages_conversation_time"
  ON "public"."messages"("conversation_id", "created_at" DESC, "id" DESC);

ALTER TABLE "public"."conversation_members"
  ADD CONSTRAINT "conversation_members_last_read_message_id_fkey"
    FOREIGN KEY ("last_read_message_id") REFERENCES "public"."messages"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE OR REPLACE FUNCTION "public"."enforce_conversation_member_family"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  conversation_family UUID;
  member_ok BOOLEAN;
BEGIN
  SELECT "family_id" INTO conversation_family
  FROM "public"."conversations" WHERE "id" = NEW."conversation_id";
  SELECT EXISTS (
    SELECT 1 FROM "public"."family_members" fm
    JOIN "public"."families" f ON f."id" = fm."family_id"
    WHERE fm."family_id" = conversation_family
      AND fm."user_id" = NEW."user_id"
      AND fm."status" = 'accepted' AND f."status" = 'active'
  ) INTO member_ok;
  IF conversation_family IS NULL OR NOT member_ok THEN
    RAISE EXCEPTION 'Conversation participant must be accepted in the active family';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_conversation_member_family"
BEFORE INSERT OR UPDATE OF "conversation_id", "user_id", "is_active"
ON "public"."conversation_members"
FOR EACH ROW WHEN (NEW."is_active")
EXECUTE FUNCTION "public"."enforce_conversation_member_family"();

CREATE OR REPLACE FUNCTION "public"."enforce_message_sender"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "public"."conversation_members" cm
    JOIN "public"."conversations" c ON c."id" = cm."conversation_id"
    JOIN "public"."family_members" fm
      ON fm."family_id" = c."family_id" AND fm."user_id" = cm."user_id"
    JOIN "public"."families" f ON f."id" = c."family_id"
    WHERE cm."conversation_id" = NEW."conversation_id"
      AND cm."user_id" = NEW."sender_id" AND cm."is_active"
      AND fm."status" = 'accepted' AND f."status" = 'active'
  ) THEN
    RAISE EXCEPTION 'Message sender is not currently authorized';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_message_sender"
BEFORE INSERT ON "public"."messages"
FOR EACH ROW EXECUTE FUNCTION "public"."enforce_message_sender"();

CREATE OR REPLACE FUNCTION "public"."enforce_conversation_read_cursor"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  cursor_conversation UUID;
  cursor_created_at TIMESTAMPTZ(6);
BEGIN
  IF NEW."last_read_message_id" IS NULL THEN RETURN NEW; END IF;
  SELECT "conversation_id", "created_at"
  INTO cursor_conversation, cursor_created_at
  FROM "public"."messages" WHERE "id" = NEW."last_read_message_id";
  IF cursor_conversation IS NULL OR cursor_conversation <> NEW."conversation_id"
     OR cursor_created_at <> NEW."last_read_message_created_at" THEN
    RAISE EXCEPTION 'Read cursor Message must belong to the Conversation';
  END IF;
  IF OLD."last_read_message_id" IS NOT NULL AND (
       NEW."last_read_message_created_at" < OLD."last_read_message_created_at"
       OR (NEW."last_read_message_created_at" = OLD."last_read_message_created_at"
         AND NEW."last_read_message_id"::text < OLD."last_read_message_id"::text)
  ) THEN
    RAISE EXCEPTION 'Conversation read cursor cannot regress';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_conversation_read_cursor"
BEFORE UPDATE OF "last_read_message_id", "last_read_message_created_at"
ON "public"."conversation_members"
FOR EACH ROW EXECUTE FUNCTION "public"."enforce_conversation_read_cursor"();

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_message_source_check"
    CHECK ("notification_type" <> 'message'
       OR ("related_table" = 'message' AND "related_id" IS NOT NULL));

ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."conversations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."conversation_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."conversation_members" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."messages" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."conversations" FROM anon, authenticated;
REVOKE ALL ON TABLE "public"."conversation_members" FROM anon, authenticated;
REVOKE ALL ON TABLE "public"."messages" FROM anon, authenticated;
REVOKE ALL ON FUNCTION "public"."enforce_conversation_member_family"() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION "public"."enforce_message_sender"() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION "public"."enforce_conversation_read_cursor"() FROM PUBLIC, anon, authenticated;
