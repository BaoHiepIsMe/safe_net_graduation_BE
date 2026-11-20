-- Safe zones carry an optional icon key chosen by the app (home, school...).
-- NULL means "no icon chosen": the app falls back to a default.
ALTER TABLE "public"."geofences"
  ADD COLUMN "icon" VARCHAR(30);

ALTER TABLE "public"."geofences"
  ADD CONSTRAINT "geofences_icon_known"
  CHECK ("icon" IS NULL OR "icon" IN ('home', 'school', 'work', 'shop', 'hospital', 'other'));
