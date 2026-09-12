-- Fix the shared geofence consistency trigger so it does not dereference
-- columns that are absent from the table currently firing the trigger.
CREATE OR REPLACE FUNCTION "public"."enforce_geofence_family_consistency"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  zone_family UUID;
  member_family UUID;
  member_user UUID;
  location_user UUID;
  location_id UUID;
BEGIN
  SELECT "family_id" INTO zone_family
  FROM "public"."geofences" WHERE "id" = NEW."geofence_id";

  SELECT "family_id", "user_id" INTO member_family, member_user
  FROM "public"."family_members" WHERE "id" = NEW."member_id";

  IF zone_family IS NULL OR member_family IS NULL
     OR NEW."family_id" <> zone_family
     OR NEW."family_id" <> member_family THEN
    RAISE EXCEPTION 'geofence, member, and family must belong to the same family'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'geofence_events' THEN
    location_id := (to_jsonb(NEW) ->> 'location_id')::UUID;
    IF location_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT "user_id" INTO location_user
    FROM "public"."locations" WHERE "id" = location_id;
  ELSIF TG_TABLE_NAME = 'geofence_states' THEN
    location_id := (to_jsonb(NEW) ->> 'last_location_id')::UUID;
    SELECT "user_id" INTO location_user
    FROM "public"."locations" WHERE "id" = location_id;
  ELSE
    RETURN NEW;
  END IF;

  IF location_user IS NULL OR location_user <> member_user THEN
    RAISE EXCEPTION 'geofence location must belong to the assigned member user'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
