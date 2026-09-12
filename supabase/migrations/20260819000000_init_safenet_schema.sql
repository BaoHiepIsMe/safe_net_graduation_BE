-- ==============================================================================
-- SafeNet Schema Initialization Migration
-- Reconciles database draft with Supabase Auth (auth.users + public.profiles)
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- Custom ENUM Types
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE family_member_role AS ENUM ('manager', 'adult', 'child', 'elder');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE membership_status AS ENUM ('pending', 'accepted', 'rejected', 'removed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE device_type AS ENUM ('android', 'ios', 'web', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE motion_state AS ENUM ('still', 'walking', 'running', 'in_vehicle', 'on_bicycle', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE geofence_event_type AS ENUM ('enter', 'exit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE camera_status AS ENUM ('online', 'offline', 'error', 'disabled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE fall_source_type AS ENUM ('phone', 'camera', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE fall_event_status AS ENUM ('detected', 'confirmed', 'false_alarm', 'resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE reminder_type AS ENUM ('medication', 'appointment', 'water', 'exercise', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE reminder_log_status AS ENUM ('pending', 'completed', 'missed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE notification_type AS ENUM (
        'fall_detected', 'geofence_enter', 'geofence_exit', 
        'reminder', 'sos', 'phone_command', 'system', 'invitation', 'message'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE sos_event_status AS ENUM ('triggered', 'calling', 'handled', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE phone_command_type AS ENUM ('lock', 'unlock', 'ring', 'warning', 'wipe', 'locate');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE phone_command_status AS ENUM ('pending', 'sent', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE conversation_type AS ENUM ('direct', 'group');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE message_type AS ENUM ('text', 'image', 'location', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE message_delivery_status AS ENUM ('sent', 'delivered', 'read');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE call_type AS ENUM ('audio', 'video');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE call_status AS ENUM ('missed', 'completed', 'rejected', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------------------------
-- 1. Profiles & User Preferences
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name text NOT NULL DEFAULT '',
    avatar_url text,
    date_of_birth date,
    gender text CHECK (gender IS NULL OR gender IN ('male', 'female', 'other')),
    phone_number text,
    account_status text NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'deactivated')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    language text NOT NULL DEFAULT 'vi',
    push_notifications_enabled boolean NOT NULL DEFAULT true,
    sms_notifications_enabled boolean NOT NULL DEFAULT true,
    email_notifications_enabled boolean NOT NULL DEFAULT true,
    location_sharing_enabled boolean NOT NULL DEFAULT true,
    dark_mode boolean NOT NULL DEFAULT false,
    quiet_hours_start time,
    quiet_hours_end time,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.biometric_settings (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    biometric_enabled boolean NOT NULL DEFAULT false,
    biometric_type text CHECK (biometric_type IS NULL OR biometric_type IN ('fingerprint', 'face', 'iris', 'none')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 2. Families & Memberships
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.families (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    avatar_url text,
    owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    invite_code text UNIQUE,
    qr_code_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.family_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role family_member_role NOT NULL DEFAULT 'adult',
    relation_label text,
    status membership_status NOT NULL DEFAULT 'accepted',
    invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    joined_at timestamptz DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_family_members_family_user UNIQUE(family_id, user_id)
);

-- ------------------------------------------------------------------------------
-- 3. Devices
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.devices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    family_member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
    device_name text NOT NULL,
    device_type device_type NOT NULL DEFAULT 'android',
    device_model text,
    os_version text,
    app_version text,
    fcm_token text,
    battery_level integer CHECK (battery_level IS NULL OR (battery_level >= 0 AND battery_level <= 100)),
    is_charging boolean DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    last_active_at timestamptz DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 4. Locations & Current State
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.locations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    family_member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
    device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
    latitude double precision NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
    longitude double precision NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
    accuracy double precision,
    altitude double precision,
    speed double precision,
    heading double precision,
    battery_level integer,
    motion_state motion_state DEFAULT 'unknown',
    recorded_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.current_locations (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    family_member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
    device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
    latitude double precision NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
    longitude double precision NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
    accuracy double precision,
    altitude double precision,
    speed double precision,
    heading double precision,
    battery_level integer,
    motion_state motion_state DEFAULT 'unknown',
    is_sharing_location boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 5. Geofences
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.geofences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    name text NOT NULL,
    latitude double precision NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
    longitude double precision NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
    radius_meters double precision NOT NULL CHECK (radius_meters > 0),
    color text DEFAULT '#3B82F6',
    is_active boolean NOT NULL DEFAULT true,
    notify_on_enter boolean NOT NULL DEFAULT true,
    notify_on_exit boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.geofence_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    geofence_id uuid NOT NULL REFERENCES public.geofences(id) ON DELETE CASCADE,
    family_member_id uuid NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_geofence_member UNIQUE(geofence_id, family_member_id)
);

CREATE TABLE IF NOT EXISTS public.geofence_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    geofence_id uuid NOT NULL REFERENCES public.geofences(id) ON DELETE CASCADE,
    family_member_id uuid NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
    event_type geofence_event_type NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    accuracy double precision,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 6. Cameras
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cameras (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    name text NOT NULL,
    location_description text,
    stream_url text,
    status camera_status NOT NULL DEFAULT 'online',
    fall_detection_enabled boolean NOT NULL DEFAULT true,
    last_online_at timestamptz DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 7. Fall Events
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fall_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
    camera_id uuid REFERENCES public.cameras(id) ON DELETE SET NULL,
    source_type fall_source_type NOT NULL DEFAULT 'phone',
    status fall_event_status NOT NULL DEFAULT 'detected',
    confidence double precision CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1.0)),
    latitude double precision,
    longitude double precision,
    accuracy double precision,
    address text,
    media_url text,
    sensor_data jsonb,
    resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    resolved_at timestamptz,
    resolution_notes text,
    idempotency_key text UNIQUE,
    detected_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 8. Reminders & Logs
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reminders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text,
    reminder_type reminder_type NOT NULL DEFAULT 'custom',
    start_time timestamptz NOT NULL,
    end_time timestamptz,
    recurrence_pattern jsonb,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reminder_targets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reminder_id uuid NOT NULL REFERENCES public.reminders(id) ON DELETE CASCADE,
    family_member_id uuid NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_reminder_target UNIQUE(reminder_id, family_member_id)
);

CREATE TABLE IF NOT EXISTS public.reminder_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reminder_id uuid NOT NULL REFERENCES public.reminders(id) ON DELETE CASCADE,
    family_member_id uuid NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
    scheduled_at timestamptz NOT NULL,
    status reminder_log_status NOT NULL DEFAULT 'pending',
    action_taken_at timestamptz,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_reminder_log_occurrence UNIQUE(reminder_id, family_member_id, scheduled_at)
);

-- ------------------------------------------------------------------------------
-- 9. Notifications
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    family_id uuid REFERENCES public.families(id) ON DELETE CASCADE,
    title text NOT NULL,
    body text NOT NULL,
    type notification_type NOT NULL DEFAULT 'system',
    data jsonb,
    is_read boolean NOT NULL DEFAULT false,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 10. SOS Contacts & Events
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sos_contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name text NOT NULL,
    phone_number text NOT NULL,
    relationship text,
    priority integer NOT NULL DEFAULT 1,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sos_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status sos_event_status NOT NULL DEFAULT 'triggered',
    latitude double precision,
    longitude double precision,
    accuracy double precision,
    address text,
    idempotency_key text UNIQUE,
    triggered_at timestamptz NOT NULL DEFAULT now(),
    handled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    handled_at timestamptz,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 11. Child Phone Management & Commands
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.phone_usage_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    family_member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
    device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
    app_name text NOT NULL,
    package_name text NOT NULL,
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    duration_seconds integer NOT NULL CHECK (duration_seconds >= 0),
    category text,
    recorded_date date NOT NULL DEFAULT CURRENT_DATE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.phone_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    target_member_id uuid NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
    daily_time_limit_minutes integer CHECK (daily_time_limit_minutes IS NULL OR daily_time_limit_minutes >= 0),
    bedtime_start time,
    bedtime_end time,
    blocked_apps jsonb DEFAULT '[]'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_family_target_rule UNIQUE(family_id, target_member_id)
);

CREATE TABLE IF NOT EXISTS public.phone_commands (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    target_member_id uuid NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
    target_device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
    command_type phone_command_type NOT NULL,
    status phone_command_status NOT NULL DEFAULT 'pending',
    payload jsonb,
    idempotency_key text UNIQUE,
    executed_at timestamptz,
    result jsonb,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 12. Daily Status Reports
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_status_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    family_member_id uuid NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
    report_date date NOT NULL,
    summary jsonb,
    location_summary jsonb,
    usage_summary jsonb,
    reminder_summary jsonb,
    fall_summary jsonb,
    activity_level text,
    fall_risk_level text,
    ai_notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_daily_report_member_date UNIQUE(family_member_id, report_date)
);

-- ------------------------------------------------------------------------------
-- 13. Conversations & Messaging
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    type conversation_type NOT NULL DEFAULT 'direct',
    name text,
    avatar_url text,
    last_message_at timestamptz DEFAULT now(),
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.conversation_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'member',
    last_read_message_id uuid,
    last_read_at timestamptz,
    joined_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_conversation_member UNIQUE(conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    message_type message_type NOT NULL DEFAULT 'text',
    content text NOT NULL DEFAULT '',
    media_url text,
    metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.message_receipts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status message_delivery_status NOT NULL DEFAULT 'sent',
    read_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_message_receipt UNIQUE(message_id, user_id)
);

-- ------------------------------------------------------------------------------
-- 14. Calls
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.call_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    caller_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    receiver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    call_type call_type NOT NULL DEFAULT 'audio',
    status call_status NOT NULL DEFAULT 'missed',
    started_at timestamptz NOT NULL DEFAULT now(),
    answered_at timestamptz,
    ended_at timestamptz,
    duration_seconds integer DEFAULT 0 CHECK (duration_seconds >= 0),
    session_metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 15. Operational Support: Audit & Idempotency
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    family_id uuid REFERENCES public.families(id) ON DELETE SET NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    details jsonb,
    ip_address text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
    key text PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    action text NOT NULL,
    request_hash text,
    response_status integer,
    response_body jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

-- ------------------------------------------------------------------------------
-- High-Performance Indexes
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_family_members_user ON public.family_members(user_id);
CREATE INDEX IF NOT EXISTS idx_family_members_family ON public.family_members(family_id);
CREATE INDEX IF NOT EXISTS idx_devices_user ON public.devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_fcm ON public.devices(fcm_token) WHERE fcm_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_locations_user_time ON public.locations(user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_locations_member_time ON public.locations(family_member_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_geofence_events_family ON public.geofence_events(geofence_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_fall_events_family ON public.fall_events(family_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_fall_events_status ON public.fall_events(status);
CREATE INDEX IF NOT EXISTS idx_reminders_family ON public.reminders(family_id, is_active);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_scheduled ON public.reminder_logs(family_member_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sos_events_family ON public.sos_events(family_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_phone_usage_member_date ON public.phone_usage_logs(family_member_id, recorded_date);
CREATE INDEX IF NOT EXISTS idx_phone_commands_target ON public.phone_commands(target_member_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_time ON public.messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON public.conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_caller ON public.call_logs(caller_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_receiver ON public.call_logs(receiver_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_action ON public.audit_logs(user_id, action, created_at DESC);

-- ------------------------------------------------------------------------------
-- Triggers for automatic profile & preferences creation on Supabase signup
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, avatar_url, phone_number)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        NEW.raw_user_meta_data->>'avatar_url',
        NEW.phone
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_settings (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.biometric_settings (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
