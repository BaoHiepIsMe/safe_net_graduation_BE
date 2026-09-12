-- Secure Foundation and Phase 1 without rewriting the initial migration.
-- NestJS authorization remains mandatory because the backend service-role bypasses RLS.

DO $$
DECLARE
    application_table regclass;
BEGIN
    FOR application_table IN
        SELECT format('%I.%I', schemaname, tablename)::regclass
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN (
            'profiles', 'user_settings', 'biometric_settings', 'families',
            'family_members', 'devices', 'locations', 'current_locations',
            'geofences', 'geofence_members', 'geofence_events', 'cameras',
            'fall_events', 'reminders', 'reminder_targets', 'reminder_logs',
            'notifications', 'sos_contacts', 'sos_events', 'phone_usage_logs',
            'phone_rules', 'phone_commands', 'daily_status_reports',
            'conversations', 'conversation_members', 'messages',
            'message_receipts', 'call_logs', 'audit_logs', 'idempotency_keys'
          )
    LOOP
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', application_table);
        EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', application_table);
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM anon, authenticated', application_table);
    END LOOP;
END;
$$;

-- Phase 1 direct-client access is intentionally limited to the caller's own rows.
-- All Phase 2+ tables remain backend-only until their authorization model is implemented.
GRANT SELECT (
    id, full_name, avatar_url, date_of_birth, gender, phone_number,
    account_status, created_at, updated_at
) ON public.profiles TO authenticated;
GRANT UPDATE (
    full_name, avatar_url, date_of_birth, gender, phone_number, updated_at
) ON public.profiles TO authenticated;

GRANT SELECT (
    user_id, language, push_notifications_enabled, sms_notifications_enabled,
    email_notifications_enabled, location_sharing_enabled, dark_mode,
    quiet_hours_start, quiet_hours_end, created_at, updated_at
) ON public.user_settings TO authenticated;
GRANT UPDATE (
    language, push_notifications_enabled, sms_notifications_enabled,
    email_notifications_enabled, location_sharing_enabled, dark_mode,
    quiet_hours_start, quiet_hours_end, updated_at
) ON public.user_settings TO authenticated;

GRANT SELECT (
    user_id, biometric_enabled, biometric_type, created_at, updated_at
) ON public.biometric_settings TO authenticated;
GRANT UPDATE (
    biometric_enabled, biometric_type, updated_at
) ON public.biometric_settings TO authenticated;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
    FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
    FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) = id)
    WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS user_settings_select_own ON public.user_settings;
CREATE POLICY user_settings_select_own ON public.user_settings
    FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS user_settings_update_own ON public.user_settings;
CREATE POLICY user_settings_update_own ON public.user_settings
    FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS biometric_settings_select_own ON public.biometric_settings;
CREATE POLICY biometric_settings_select_own ON public.biometric_settings
    FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS biometric_settings_update_own ON public.biometric_settings;
CREATE POLICY biometric_settings_update_own ON public.biometric_settings
    FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

-- New writes must satisfy Phase 1 integrity constraints. NOT VALID avoids an unsafe
-- deployment failure if historical rows need a separate cleanup migration.
DO $$ BEGIN
    ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_full_name_length
        CHECK (char_length(full_name) <= 100) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE public.user_settings
        ADD CONSTRAINT user_settings_language_supported
        CHECK (language IN ('vi', 'en')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE public.biometric_settings
        ADD CONSTRAINT biometric_settings_consistent
        CHECK (
          (biometric_enabled AND biometric_type IN ('fingerprint', 'face', 'iris'))
          OR (NOT biometric_enabled AND (biometric_type IS NULL OR biometric_type = 'none'))
        ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Signup is the single source of truth. These rows are created in the same
-- transaction as auth.users by the database trigger.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, avatar_url, phone_number)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        NEW.raw_user_meta_data->>'avatar_url',
        COALESCE(NEW.raw_user_meta_data->>'phone_number', NEW.phone)
    );

    INSERT INTO public.user_settings (user_id) VALUES (NEW.id);
    INSERT INTO public.biometric_settings (user_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
