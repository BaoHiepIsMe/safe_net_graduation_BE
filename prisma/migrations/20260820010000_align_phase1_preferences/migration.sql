-- Align the deployed preference table with the already-published Phase 1 API.
-- Existing deployed columns remain in place and retain their data.
ALTER TABLE "public"."user_settings"
  ADD COLUMN IF NOT EXISTS "sms_notifications_enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "email_notifications_enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "location_sharing_enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "dark_mode" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "quiet_hours_start" time,
  ADD COLUMN IF NOT EXISTS "quiet_hours_end" time;
