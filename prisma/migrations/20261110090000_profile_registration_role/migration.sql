ALTER TABLE public.profiles
  ADD COLUMN role VARCHAR(20) NULL,
  ADD CONSTRAINT profiles_role_supported
  CHECK (role IN ('personal', 'parent', 'guardian'));

-- Preserve the existing atomic Auth -> profile/settings creation path.
-- Optional metadata remains nullable for other approved Auth creation paths.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (
        id, full_name, email, phone, avatar_url, gender, date_of_birth, role
    )
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        NEW.email,
        -- Auth owns the phone identity; expose it in the API's +country-code
        -- format. Keep the metadata fallback for older email-only signups.
        CASE
            WHEN NULLIF(NEW.phone, '') IS NOT NULL
                THEN '+' || ltrim(NEW.phone, '+')
            ELSE NULLIF(NEW.raw_user_meta_data->>'phone_number', '')
        END,
        NEW.raw_user_meta_data->>'avatar_url',
        NULLIF(NEW.raw_user_meta_data->>'gender', ''),
        NULLIF(NEW.raw_user_meta_data->>'date_of_birth', '')::date,
        NULLIF(NEW.raw_user_meta_data->>'role', '')
    );
    INSERT INTO public.user_settings (user_id) VALUES (NEW.id);
    INSERT INTO public.biometric_settings (user_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
