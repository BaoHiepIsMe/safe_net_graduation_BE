-- Family invite codes expire; families.invite_code already exists and is unique.
-- NULL means "no live code": existing families get one lazily on first view.
ALTER TABLE "public"."families"
  ADD COLUMN "invite_code_expires_at" TIMESTAMPTZ(6);
