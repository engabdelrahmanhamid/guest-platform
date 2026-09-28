CREATE TYPE "public"."guest_source" AS ENUM('manual', 'excel_import', 'walk_in', 'api');--> statement-breakpoint
CREATE TYPE "public"."guest_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."import_decision" AS ENUM('import', 'skip', 'add_anyway');--> statement-breakpoint
CREATE TYPE "public"."import_row_state" AS ENUM('ready', 'needs_review', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'parsed', 'committing', 'committed', 'failed', 'discarded');--> statement-breakpoint
CREATE TABLE "guest_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_groups_event_id_id" UNIQUE("event_id","id"),
	CONSTRAINT "guest_groups_name_clean" CHECK (char_length("guest_groups"."name") BETWEEN 1 AND 60 AND "guest_groups"."name" = btrim("guest_groups"."name"))
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"group_id" uuid,
	"full_name" text NOT NULL,
	"name_search" text NOT NULL,
	"phone_original" text,
	"phone_e164" text,
	"email" "citext",
	"allowed_companions" smallint NOT NULL,
	"notes" text,
	"source" "guest_source" NOT NULL,
	"status" "guest_status" DEFAULT 'active' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"anonymized_at" timestamp with time zone,
	"import_row_id" uuid,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guests_event_id_id" UNIQUE("event_id","id"),
	CONSTRAINT "guests_name_len" CHECK ("guests"."anonymized_at" IS NOT NULL OR char_length("guests"."full_name") BETWEEN 1 AND 150),
	CONSTRAINT "guests_phone_format" CHECK ("guests"."phone_e164" IS NULL OR "guests"."phone_e164" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "guests_phone_required" CHECK ("guests"."source" = 'walk_in' OR "guests"."phone_e164" IS NOT NULL OR "guests"."anonymized_at" IS NOT NULL),
	CONSTRAINT "guests_companions_range" CHECK ("guests"."allowed_companions" BETWEEN 0 AND 20),
	CONSTRAINT "guests_email_len" CHECK ("guests"."email" IS NULL OR char_length("guests"."email") <= 254),
	CONSTRAINT "guests_notes_len" CHECK ("guests"."notes" IS NULL OR char_length("guests"."notes") <= 1000),
	CONSTRAINT "guests_cancellation_consistent" CHECK (("guests"."status" = 'cancelled') = ("guests"."cancelled_at" IS NOT NULL)
       AND ("guests"."cancel_reason" IS NULL OR "guests"."status" = 'cancelled')),
	CONSTRAINT "guests_cancel_reason_len" CHECK ("guests"."cancel_reason" IS NULL OR char_length("guests"."cancel_reason") BETWEEN 1 AND 300),
	CONSTRAINT "guests_import_source" CHECK ("guests"."import_row_id" IS NULL OR "guests"."source" = 'excel_import')
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"status" "import_status" NOT NULL,
	"original_filename" text NOT NULL,
	"file_sha256" text NOT NULL,
	"file_size" integer NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"ready_count" integer DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"invalid_count" integer DEFAULT 0 NOT NULL,
	"imported_count" integer,
	"skipped_count" integer,
	"error_code" text,
	"error_detail" jsonb,
	"uploaded_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parsed_at" timestamp with time zone,
	"committed_at" timestamp with time zone,
	"discarded_at" timestamp with time zone,
	CONSTRAINT "import_batches_event_id_id" UNIQUE("event_id","id"),
	CONSTRAINT "import_batches_committed_consistent" CHECK (("import_batches"."status" = 'committed') = ("import_batches"."committed_at" IS NOT NULL)),
	CONSTRAINT "import_batches_failed_has_code" CHECK ("import_batches"."status" <> 'failed' OR "import_batches"."error_code" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"full_name" text,
	"phone_original" text,
	"phone_e164" text,
	"email" text,
	"group_name" text,
	"allowed_companions" smallint,
	"notes" text,
	"validation" "import_row_state" NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision" "import_decision",
	"guest_id" uuid,
	CONSTRAINT "import_rows_batch_row" UNIQUE("batch_id","row_number"),
	CONSTRAINT "import_rows_invalid_not_imported" CHECK ("import_rows"."validation" <> 'invalid' OR "import_rows"."decision" IS NULL OR "import_rows"."decision" = 'skip')
);
--> statement-breakpoint
ALTER TABLE "guest_groups" ADD CONSTRAINT "guest_groups_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_import_row_id_import_rows_id_fk" FOREIGN KEY ("import_row_id") REFERENCES "public"."import_rows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_created_by_membership_id_event_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."event_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_group_fk" FOREIGN KEY ("event_id","group_id") REFERENCES "public"."guest_groups"("event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_membership_id_event_memberships_id_fk" FOREIGN KEY ("uploaded_by_membership_id") REFERENCES "public"."event_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_event_fk" FOREIGN KEY ("event_id","batch_id") REFERENCES "public"."import_batches"("event_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_groups_event_name" ON "guest_groups" USING btree ("event_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "guests_import_row_once" ON "guests" USING btree ("import_row_id") WHERE "guests"."import_row_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "guests_event_phone_idx" ON "guests" USING btree ("event_id","phone_e164");--> statement-breakpoint
CREATE INDEX "guests_event_status_group_idx" ON "guests" USING btree ("event_id","status","group_id");--> statement-breakpoint
CREATE INDEX "guests_event_created_idx" ON "guests" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "guests_name_search_trgm" ON "guests" USING gin ("name_search" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "import_batches_event_idx" ON "import_batches" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_one_committing" ON "import_batches" USING btree ("event_id") WHERE "import_batches"."status" = 'committing';--> statement-breakpoint
CREATE INDEX "import_rows_batch_state_idx" ON "import_rows" USING btree ("batch_id","validation","row_number");--> statement-breakpoint
-- A guest belongs to exactly one event for its whole life.
CREATE FUNCTION forbid_guest_event_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
    RAISE EXCEPTION 'a guest cannot move to another event' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER guests_event_fixed
  BEFORE UPDATE OF event_id ON guests
  FOR EACH ROW EXECUTE FUNCTION forbid_guest_event_change();
