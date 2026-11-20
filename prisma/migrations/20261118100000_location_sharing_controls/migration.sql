-- Location sharing controls: who may see me, how I share, exit alerts.
-- location_visibility 'all' = every accepted family member (previous
-- behaviour); 'selected' = only users listed in location_share_viewers.
ALTER TABLE "public"."user_settings"
  ADD COLUMN "sharing_mode" VARCHAR(20) NOT NULL DEFAULT 'continuous',
  ADD COLUMN "location_visibility" VARCHAR(20) NOT NULL DEFAULT 'all',
  ADD COLUMN "notify_on_zone_exit" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "public"."user_settings"
  ADD CONSTRAINT "user_settings_sharing_mode_known"
  CHECK ("sharing_mode" IN ('continuous', 'battery_saver')),
  ADD CONSTRAINT "user_settings_location_visibility_known"
  CHECK ("location_visibility" IN ('all', 'selected'));

CREATE TABLE "public"."location_share_viewers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_user_id" UUID NOT NULL,
  "viewer_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "location_share_viewers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "location_share_viewers_not_self" CHECK ("owner_user_id" <> "viewer_user_id"),
  CONSTRAINT "location_share_viewers_owner_fkey" FOREIGN KEY ("owner_user_id")
    REFERENCES "public"."profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "location_share_viewers_viewer_fkey" FOREIGN KEY ("viewer_user_id")
    REFERENCES "public"."profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "location_share_viewers_owner_user_id_viewer_user_id_key"
  ON "public"."location_share_viewers"("owner_user_id", "viewer_user_id");
CREATE INDEX "idx_location_share_viewers_viewer"
  ON "public"."location_share_viewers"("viewer_user_id");

ALTER TABLE "public"."location_share_viewers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."location_share_viewers" FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "public"."location_share_viewers" FROM anon, authenticated;
