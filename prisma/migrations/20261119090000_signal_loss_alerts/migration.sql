-- Alerts when a sharing phone goes silent. notify_on_signal_lost lets the
-- owner stop the family being told about them. The index serves the sweep
-- that looks for stale current locations.
ALTER TABLE "public"."user_settings"
  ADD COLUMN "notify_on_signal_lost" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "idx_current_locations_updated_at"
  ON "public"."current_locations"("updated_at");
