CREATE TYPE "public"."actor_type" AS ENUM('guest', 'member', 'user', 'system', 'provider', 'admin');--> statement-breakpoint
CREATE TYPE "public"."auth_token_purpose" AS ENUM('email_verification', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."event_category" AS ENUM('private', 'business');--> statement-breakpoint
CREATE TYPE "public"."event_role" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'active', 'live', 'completed', 'cancelled', 'archived');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('wedding', 'malka', 'engagement', 'graduation', 'birthday', 'private_dinner', 'conference', 'corporate', 'product_launch', 'opening', 'ceremony', 'exhibition', 'other');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('ar', 'en');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'removed');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('none', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."workspace_kind" AS ENUM('personal', 'organization');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('owner');--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"bucket" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "auth_token_purpose" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"mfa_verified_at" timestamp with time zone,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"email_verified_at" timestamp with time zone,
	"phone_e164" text,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"locale" "locale" DEFAULT 'ar' NOT NULL,
	"platform_role" "platform_role" DEFAULT 'none' NOT NULL,
	"totp_secret_enc" "bytea",
	"totp_enabled_at" timestamp with time zone,
	"totp_last_step" bigint,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"disabled_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_full_name_len" CHECK (char_length("users"."full_name") BETWEEN 1 AND 120),
	CONSTRAINT "users_phone_format" CHECK ("users"."phone_e164" IS NULL OR "users"."phone_e164" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "users_disabled_consistent" CHECK (("users"."status" = 'disabled') = ("users"."disabled_at" IS NOT NULL)),
	CONSTRAINT "users_totp_enabled_needs_secret" CHECK ("users"."totp_enabled_at" IS NULL OR "users"."totp_secret_enc" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_pkey" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "workspace_kind" NOT NULL,
	"name" text NOT NULL,
	"retention_guest_pii_days" integer,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_retention_positive" CHECK ("workspaces"."retention_guest_pii_days" IS NULL OR "workspaces"."retention_guest_pii_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "event_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid,
	"role" "event_role" NOT NULL,
	"is_supervisor" boolean DEFAULT false NOT NULL,
	"display_name" text NOT NULL,
	"phone_e164" text,
	"email" "citext",
	"status" "membership_status" NOT NULL,
	"created_by_membership_id" uuid,
	"removed_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "event_memberships_owner_has_user" CHECK ("event_memberships"."role" <> 'owner' OR "event_memberships"."user_id" IS NOT NULL),
	CONSTRAINT "event_memberships_supervisor_only_staff" CHECK (NOT "event_memberships"."is_supervisor" OR "event_memberships"."role" = 'staff'),
	CONSTRAINT "event_memberships_removed_consistent" CHECK (("event_memberships"."status" = 'removed') = ("event_memberships"."removed_at" IS NOT NULL)),
	CONSTRAINT "event_memberships_name_len" CHECK (char_length("event_memberships"."display_name") BETWEEN 1 AND 80),
	CONSTRAINT "event_memberships_phone_format" CHECK ("event_memberships"."phone_e164" IS NULL OR "event_memberships"."phone_e164" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"category" "event_category" NOT NULL,
	"type" "event_type" NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"timezone" text DEFAULT 'Asia/Riyadh' NOT NULL,
	"city" text NOT NULL,
	"venue_name" text NOT NULL,
	"address" text,
	"maps_url" text,
	"description" text,
	"cover_image_key" text,
	"logo_key" text,
	"default_allowed_companions" smallint DEFAULT 0 NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"auto_open_checkin" boolean NOT NULL,
	"checkin_opens_offset_min" integer NOT NULL,
	"assumed_duration_min" integer NOT NULL,
	"auto_close_checkin" boolean NOT NULL,
	"checkin_closes_offset_min" integer NOT NULL,
	"reopen_window_min" integer NOT NULL,
	"published_at" timestamp with time zone,
	"live_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"reopened_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"cancelled_by_membership_id" uuid,
	"archived_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_name_len" CHECK (char_length("events"."name") BETWEEN 1 AND 150),
	CONSTRAINT "events_city_len" CHECK (char_length("events"."city") BETWEEN 1 AND 80),
	CONSTRAINT "events_venue_len" CHECK (char_length("events"."venue_name") BETWEEN 1 AND 150),
	CONSTRAINT "events_address_len" CHECK ("events"."address" IS NULL OR char_length("events"."address") <= 300),
	CONSTRAINT "events_description_len" CHECK ("events"."description" IS NULL OR char_length("events"."description") <= 1000),
	CONSTRAINT "events_maps_url_format" CHECK ("events"."maps_url" IS NULL OR ("events"."maps_url" ~ '^https?://' AND char_length("events"."maps_url") <= 500)),
	CONSTRAINT "events_ends_after_starts" CHECK ("events"."ends_at" IS NULL OR "events"."ends_at" > "events"."starts_at"),
	CONSTRAINT "events_companions_range" CHECK ("events"."default_allowed_companions" BETWEEN 0 AND 20),
	CONSTRAINT "events_category_type" CHECK (("events"."category" = 'private' AND "events"."type" IN ('wedding','malka','engagement','graduation','birthday','private_dinner','other'))
       OR ("events"."category" = 'business' AND "events"."type" IN ('conference','corporate','product_launch','opening','ceremony','exhibition','other'))),
	CONSTRAINT "events_opens_offset_range" CHECK ("events"."checkin_opens_offset_min" BETWEEN -10080 AND 0),
	CONSTRAINT "events_duration_range" CHECK ("events"."assumed_duration_min" BETWEEN 30 AND 4320),
	CONSTRAINT "events_closes_offset_range" CHECK ("events"."checkin_closes_offset_min" BETWEEN 0 AND 4320),
	CONSTRAINT "events_reopen_window_range" CHECK ("events"."reopen_window_min" BETWEEN 0 AND 10080),
	CONSTRAINT "events_published_when_not_draft" CHECK ("events"."status" = 'draft' OR "events"."published_at" IS NOT NULL),
	CONSTRAINT "events_live_at_when_live" CHECK ("events"."status" <> 'live' OR "events"."live_at" IS NOT NULL),
	CONSTRAINT "events_completed_at_when_completed" CHECK ("events"."status" <> 'completed' OR "events"."completed_at" IS NOT NULL),
	CONSTRAINT "events_cancellation_consistent" CHECK (("events"."cancelled_at" IS NULL) = ("events"."cancellation_reason" IS NULL)
       AND ("events"."status" <> 'cancelled' OR "events"."cancelled_at" IS NOT NULL)),
	CONSTRAINT "events_cancellation_reason_len" CHECK ("events"."cancellation_reason" IS NULL OR char_length("events"."cancellation_reason") BETWEEN 1 AND 500),
	CONSTRAINT "events_archived_at_when_archived" CHECK ("events"."status" <> 'archived' OR "events"."archived_at" IS NOT NULL),
	CONSTRAINT "events_disabled_consistent" CHECK (("events"."disabled_at" IS NULL) = ("events"."disabled_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid,
	"workspace_id" uuid,
	"guest_id" uuid,
	"type" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_membership_id" uuid,
	"actor_user_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_memberships" ADD CONSTRAINT "event_memberships_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_memberships" ADD CONSTRAINT "event_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_memberships" ADD CONSTRAINT "event_memberships_created_by_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."event_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_memberships" ADD CONSTRAINT "event_memberships_removed_by_fk" FOREIGN KEY ("removed_by_membership_id") REFERENCES "public"."event_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_cancelled_by_membership_id_event_memberships_id_fk" FOREIGN KEY ("cancelled_by_membership_id") REFERENCES "public"."event_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_membership_id_event_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "public"."event_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_idx" ON "auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_key" ON "users" USING btree ("phone_e164") WHERE "users"."phone_e164" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_one_personal_per_user" ON "workspaces" USING btree ("created_by_user_id") WHERE "workspaces"."kind" = 'personal';--> statement-breakpoint
CREATE UNIQUE INDEX "event_memberships_one_owner" ON "event_memberships" USING btree ("event_id") WHERE "event_memberships"."role" = 'owner' AND "event_memberships"."status" <> 'removed';--> statement-breakpoint
CREATE UNIQUE INDEX "event_memberships_user_once" ON "event_memberships" USING btree ("event_id","user_id") WHERE "event_memberships"."user_id" IS NOT NULL AND "event_memberships"."status" <> 'removed';--> statement-breakpoint
CREATE INDEX "event_memberships_user_idx" ON "event_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_workspace_status_idx" ON "events" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "events_status_starts_idx" ON "events" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "activity_event_idx" ON "activity" USING btree ("event_id","id");--> statement-breakpoint
CREATE INDEX "activity_event_guest_idx" ON "activity" USING btree ("event_id","guest_id","id");--> statement-breakpoint
CREATE INDEX "admin_audit_target_idx" ON "admin_audit_log" USING btree ("target_type","target_id");