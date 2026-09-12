-- Preserve SafeNet's defense-in-depth RLS, least-privilege grants, integrity
-- constraints, and auth signup trigger after the Prisma baseline.
-- NestJS authorization remains mandatory because the service connection can bypass RLS.

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
            'conversations', 'conversation_members', 'messages', 'call_logs'
          )
    LOOP
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', application_table);
        EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', application_table);
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM anon, authenticated', application_table);
    END LOOP;
END;
$$;

GRANT SELECT (
    id, full_name, avatar_url, date_of_birth, gender, phone,
    account_status, created_at, updated_at
) ON public.profiles TO authenticated;
GRANT UPDATE (
    full_name, avatar_url, date_of_birth, gender, phone
) ON public.profiles TO authenticated;

GRANT SELECT (
    user_id, language, allow_push_notification, sms_notifications_enabled,
    email_notifications_enabled, location_sharing_enabled, dark_mode,
    quiet_hours_start, quiet_hours_end, updated_at
) ON public.user_settings TO authenticated;
GRANT UPDATE (
    language, allow_push_notification, sms_notifications_enabled,
    email_notifications_enabled, location_sharing_enabled, dark_mode,
    quiet_hours_start, quiet_hours_end
) ON public.user_settings TO authenticated;

GRANT SELECT (
    user_id, is_enabled, biometric_type, updated_at
) ON public.biometric_settings TO authenticated;
GRANT UPDATE (
    is_enabled, biometric_type
) ON public.biometric_settings TO authenticated;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
    FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
    FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) = id)
    WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS user_settings_select_own ON public.user_settings;
CREATE POLICY user_settings_select_own ON public.user_settings
    FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS user_settings_update_own ON public.user_settings;
CREATE POLICY user_settings_update_own ON public.user_settings
    FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS biometric_settings_select_own ON public.biometric_settings;
CREATE POLICY biometric_settings_select_own ON public.biometric_settings
    FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS biometric_settings_update_own ON public.biometric_settings;
CREATE POLICY biometric_settings_update_own ON public.biometric_settings
    FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

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
          (is_enabled AND biometric_type IN ('fingerprint', 'face', 'iris'))
          OR (NOT is_enabled AND (biometric_type IS NULL OR biometric_type = 'none'))
        ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, email, phone, avatar_url)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'phone_number', NEW.phone),
        NEW.raw_user_meta_data->>'avatar_url'
    );
    INSERT INTO public.user_settings (user_id) VALUES (NEW.id);
    INSERT INTO public.biometric_settings (user_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
