-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "biometric_settings" (
    "user_id" UUID NOT NULL,
    "is_enabled" BOOLEAN DEFAULT false,
    "biometric_type" VARCHAR(30),
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biometric_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "call_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "family_id" UUID NOT NULL,
    "caller_id" UUID NOT NULL,
    "receiver_id" UUID NOT NULL,
    "call_type" VARCHAR(20),
    "status" VARCHAR(30),
    "started_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "duration_seconds" INTEGER,

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cameras" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "family_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "camera_name" VARCHAR(100) NOT NULL,
    "location_name" VARCHAR(100),
    "stream_url" TEXT,
    "is_fall_detection_enabled" BOOLEAN DEFAULT true,
    "status" VARCHAR(20) DEFAULT 'active',
    "last_online_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cameras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "family_id" UUID NOT NULL,
    "title" VARCHAR(100),
    "conversation_type" VARCHAR(20) DEFAULT 'direct',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "current_locations" (
    "member_id" UUID NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "battery_level" INTEGER,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "current_locations_pkey" PRIMARY KEY ("member_id")
);

-- CreateTable
CREATE TABLE "daily_status_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "family_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "report_date" DATE NOT NULL,
    "location_summary" TEXT,
    "phone_usage_summary" TEXT,
    "reminder_summary" TEXT,
    "fall_risk_level" VARCHAR(20),
    "activity_level" VARCHAR(20),
    "ai_summary" TEXT,
    "ai_data" JSONB,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_status_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "device_name" VARCHAR(100),
    "device_type" VARCHAR(30),
    "os" VARCHAR(30),
    "device_identifier" TEXT,
    "fcm_token" TEXT,
    "battery_level" INTEGER,
    "is_active" BOOLEAN DEFAULT true,
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fall_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "family_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "source_type" VARCHAR(30) NOT NULL,
    "device_id" UUID,
    "camera_id" UUID,
    "confidence_score" DOUBLE PRECISION,
    "status" VARCHAR(30) DEFAULT 'detected',
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "image_url" TEXT,
    "video_url" TEXT,
    "sensor_data" JSONB,
    "ai_result" JSONB,
    "detected_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "note" TEXT,

    CONSTRAINT "fall_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "families" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "family_name" VARCHAR(100) NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "avatar_url" TEXT,
    "invite_code" VARCHAR(20),
    "status" VARCHAR(20) DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "family_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "invited_by_user_id" UUID,
    "role" VARCHAR(30) NOT NULL,
    "family_label" VARCHAR(50) NOT NULL,
    "display_name" VARCHAR(100),
    "status" VARCHAR(30) DEFAULT 'pending',
    "location_sharing_enabled" BOOLEAN DEFAULT true,
    "invited_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(6),
    "removed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofence_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "family_id" UUID NOT NULL,
    "geofence_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "event_type" VARCHAR(20) NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "detected_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geofence_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofence_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "geofence_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "notify_on_enter" BOOLEAN DEFAULT true,
    "notify_on_exit" BOOLEAN DEFAULT true,

    CONSTRAINT "geofence_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "family_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "address" TEXT,
    "center_latitude" DECIMAL(10,7) NOT NULL,
    "center_longitude" DECIMAL(10,7) NOT NULL,
    "radius_meters" INTEGER NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "member_id" UUID NOT NULL,
    "device_id" UUID,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "battery_level" INTEGER,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "message_type" VARCHAR(20) DEFAULT 'text',
    "content" TEXT,
    "media_url" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "family_id" UUID,
    "recipient_user_id" UUID NOT NULL,
    "sender_user_id" UUID,
    "notification_type" VARCHAR(40) NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "message" TEXT NOT NULL,
    "related_table" VARCHAR(50),
    "related_id" UUID,
    "is_read" BOOLEAN DEFAULT false,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_commands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "target_device_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "command_type" VARCHAR(30) NOT NULL,
    "command_payload" JSONB,
    "status" VARCHAR(30) DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "executed_at" TIMESTAMPTZ(6),

    CONSTRAINT "phone_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "family_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "daily_limit_minutes" INTEGER,
    "bedtime_start" TIME(6),
    "bedtime_end" TIME(6),
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_usage_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "member_id" UUID NOT NULL,
    "device_id" UUID,
    "app_name" VARCHAR(100),
    "app_package" VARCHAR(150),
    "start_time" TIMESTAMPTZ(6) NOT NULL,
    "end_time" TIMESTAMPTZ(6),
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "full_name" VARCHAR(100),
    "email" VARCHAR(150),
    "phone" VARCHAR(20),
    "avatar_url" TEXT,
    "date_of_birth" DATE,
    "gender" VARCHAR(20),
    "account_status" VARCHAR(20) DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reminder_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR(30) DEFAULT 'pending',
    "responded_at" TIMESTAMPTZ(6),
    "note" TEXT,

    CONSTRAINT "reminder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_targets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reminder_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,

    CONSTRAINT "reminder_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "family_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "reminder_type" VARCHAR(30),
    "start_time" TIMESTAMPTZ(6) NOT NULL,
    "repeat_type" VARCHAR(30) DEFAULT 'none',
    "repeat_rule" JSONB,
    "end_time" TIMESTAMPTZ(6),
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sos_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "member_id" UUID NOT NULL,
    "contact_user_id" UUID,
    "contact_name" VARCHAR(100),
    "phone" VARCHAR(20) NOT NULL,
    "priority" INTEGER DEFAULT 1,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sos_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sos_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "family_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "status" VARCHAR(30) DEFAULT 'triggered',
    "triggered_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "handled_by" UUID,
    "handled_at" TIMESTAMPTZ(6),
    "note" TEXT,

    CONSTRAINT "sos_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" UUID NOT NULL,
    "theme" VARCHAR(30) DEFAULT 'system',
    "language" VARCHAR(20) DEFAULT 'vi',
    "allow_push_notification" BOOLEAN DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "idx_call_logs_caller_time" ON "call_logs"("caller_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "idx_call_logs_receiver_time" ON "call_logs"("receiver_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "idx_conversation_members_conversation" ON "conversation_members"("conversation_id");

-- CreateIndex
CREATE INDEX "idx_conversation_members_user" ON "conversation_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_members_conversation_id_user_id_key" ON "conversation_members"("conversation_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_conversations_family" ON "conversations"("family_id");

-- CreateIndex
CREATE INDEX "idx_current_locations_member" ON "current_locations"("member_id");

-- CreateIndex
CREATE INDEX "idx_daily_reports_member_date" ON "daily_status_reports"("member_id", "report_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "daily_status_reports_member_id_report_date_key" ON "daily_status_reports"("member_id", "report_date");

-- CreateIndex
CREATE INDEX "idx_devices_user" ON "devices"("user_id");

-- CreateIndex
CREATE INDEX "idx_fall_events_family_time" ON "fall_events"("family_id", "detected_at" DESC);

-- CreateIndex
CREATE INDEX "idx_fall_events_member_time" ON "fall_events"("member_id", "detected_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "families_invite_code_key" ON "families"("invite_code");

-- CreateIndex
CREATE INDEX "idx_families_owner" ON "families"("owner_user_id");

-- CreateIndex
CREATE INDEX "idx_family_members_family" ON "family_members"("family_id");

-- CreateIndex
CREATE INDEX "idx_family_members_status" ON "family_members"("status");

-- CreateIndex
CREATE INDEX "idx_family_members_user" ON "family_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_members_family_id_user_id_key" ON "family_members"("family_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_geofence_events_family_time" ON "geofence_events"("family_id", "detected_at" DESC);

-- CreateIndex
CREATE INDEX "idx_geofence_events_member_time" ON "geofence_events"("member_id", "detected_at" DESC);

-- CreateIndex
CREATE INDEX "idx_geofence_members_member" ON "geofence_members"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "geofence_members_geofence_id_member_id_key" ON "geofence_members"("geofence_id", "member_id");

-- CreateIndex
CREATE INDEX "idx_geofences_family" ON "geofences"("family_id");

-- CreateIndex
CREATE INDEX "idx_locations_member_time" ON "locations"("member_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "idx_messages_conversation_time" ON "messages"("conversation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_notifications_recipient_time" ON "notifications"("recipient_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_notifications_unread" ON "notifications"("recipient_user_id", "is_read");

-- CreateIndex
CREATE INDEX "idx_phone_usage_member_time" ON "phone_usage_logs"("member_id", "start_time" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_email_key" ON "profiles"("email");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_phone_key" ON "profiles"("phone");

-- CreateIndex
CREATE INDEX "idx_profiles_email" ON "profiles"("email");

-- CreateIndex
CREATE INDEX "idx_profiles_phone" ON "profiles"("phone");

-- CreateIndex
CREATE INDEX "idx_reminder_logs_member_time" ON "reminder_logs"("member_id", "scheduled_at" DESC);

-- CreateIndex
CREATE INDEX "idx_reminder_targets_member" ON "reminder_targets"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_targets_reminder_id_member_id_key" ON "reminder_targets"("reminder_id", "member_id");

-- CreateIndex
CREATE INDEX "idx_reminders_family" ON "reminders"("family_id");

-- CreateIndex
CREATE INDEX "idx_sos_contacts_member" ON "sos_contacts"("member_id");

-- CreateIndex
CREATE INDEX "idx_sos_events_member_time" ON "sos_events"("member_id", "triggered_at" DESC);

-- AddForeignKey
ALTER TABLE "biometric_settings" ADD CONSTRAINT "biometric_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_caller_id_fkey" FOREIGN KEY ("caller_id") REFERENCES "profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "current_locations" ADD CONSTRAINT "current_locations_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "daily_status_reports" ADD CONSTRAINT "daily_status_reports_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "daily_status_reports" ADD CONSTRAINT "daily_status_reports_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fall_events" ADD CONSTRAINT "fall_events_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "cameras"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fall_events" ADD CONSTRAINT "fall_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fall_events" ADD CONSTRAINT "fall_events_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fall_events" ADD CONSTRAINT "fall_events_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fall_events" ADD CONSTRAINT "fall_events_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "families" ADD CONSTRAINT "families_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_geofence_id_fkey" FOREIGN KEY ("geofence_id") REFERENCES "geofences"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "geofence_members" ADD CONSTRAINT "geofence_members_geofence_id_fkey" FOREIGN KEY ("geofence_id") REFERENCES "geofences"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "geofence_members" ADD CONSTRAINT "geofence_members_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phone_commands" ADD CONSTRAINT "phone_commands_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phone_commands" ADD CONSTRAINT "phone_commands_target_device_id_fkey" FOREIGN KEY ("target_device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phone_rules" ADD CONSTRAINT "phone_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phone_rules" ADD CONSTRAINT "phone_rules_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phone_rules" ADD CONSTRAINT "phone_rules_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phone_usage_logs" ADD CONSTRAINT "phone_usage_logs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phone_usage_logs" ADD CONSTRAINT "phone_usage_logs_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "reminders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reminder_targets" ADD CONSTRAINT "reminder_targets_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reminder_targets" ADD CONSTRAINT "reminder_targets_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "reminders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sos_contacts" ADD CONSTRAINT "sos_contacts_contact_user_id_fkey" FOREIGN KEY ("contact_user_id") REFERENCES "profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sos_contacts" ADD CONSTRAINT "sos_contacts_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Cross-schema relation intentionally omitted from Prisma Client ownership.
-- Supabase Auth owns auth.users; this constraint is nevertheless part of the baseline.
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
