CREATE TYPE "public"."invitation_delivery" AS ENUM('not_sent', 'queued', 'shared', 'sent', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."invitation_template" AS ENUM('elegant', 'minimal', 'formal', 'celebration');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('invitation', 'reminder');--> statement-breakpoint
CREATE TYPE "public"."pass_revoke_reason" AS ENUM('declined', 'guest_cancelled', 'replaced');--> statement-breakpoint
CREATE TYPE "public"."pass_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."rsvp_status" AS ENUM('pending', 'confirmed', 'declined');--> statement-breakpoint
CREATE TABLE "guest_passes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"token" text NOT NULL,
	"status" "pass_status" DEFAULT 'active' NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" "pass_revoke_reason",
	"replaced_by_pass_id" uuid,
	CONSTRAINT "guest_passes_token" UNIQUE("token"),
	CONSTRAINT "guest_passes_token_format" CHECK ("guest_passes"."token" ~ '^[0-9A-Za-z]{22}$'),
	CONSTRAINT "guest_passes_revoked_consistent" CHECK (("guest_passes"."status" = 'revoked') = ("guest_passes"."revoked_at" IS NOT NULL)
       AND ("guest_passes"."revoked_at" IS NULL) = ("guest_passes"."revoke_reason" IS NULL)),
	CONSTRAINT "guest_passes_replaced_consistent" CHECK ("guest_passes"."replaced_by_pass_id" IS NULL OR "guest_passes"."revoke_reason" = 'replaced')
);
--> statement-breakpoint
CREATE TABLE "invitation_designs" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"template" "invitation_template" NOT NULL,
	"primary_color" text NOT NULL,
	"title" text,
	"body_text" text,
	"show_date" boolean DEFAULT true NOT NULL,
	"show_time" boolean DEFAULT true NOT NULL,
	"show_venue" boolean DEFAULT true NOT NULL,
	"show_address" boolean DEFAULT true NOT NULL,
	"show_map" boolean DEFAULT true NOT NULL,
	"show_description" boolean DEFAULT true NOT NULL,
	"show_countdown" boolean DEFAULT true NOT NULL,
	"updated_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_designs_color" CHECK ("invitation_designs"."primary_color" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "invitation_designs_title_len" CHECK ("invitation_designs"."title" IS NULL OR char_length("invitation_designs"."title") BETWEEN 1 AND 120),
	CONSTRAINT "invitation_designs_body_len" CHECK ("invitation_designs"."body_text" IS NULL OR char_length("invitation_designs"."body_text") BETWEEN 1 AND 600)
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"token" text NOT NULL,
	"delivery_status" "invitation_delivery" DEFAULT 'not_sent' NOT NULL,
	"first_shared_at" timestamp with time zone,
	"last_shared_at" timestamp with time zone,
	"share_count" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"open_count" integer DEFAULT 0 NOT NULL,
	"token_rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_guest_once" UNIQUE("guest_id"),
	CONSTRAINT "invitations_token" UNIQUE("token"),
	CONSTRAINT "invitations_token_format" CHECK ("invitations"."token" ~ '^[0-9A-Za-z]{22}$'),
	CONSTRAINT "invitations_counts" CHECK ("invitations"."share_count" >= 0 AND "invitations"."open_count" >= 0),
	CONSTRAINT "invitations_share_consistent" CHECK (("invitations"."share_count" = 0) = ("invitations"."first_shared_at" IS NULL)
       AND ("invitations"."first_shared_at" IS NULL) = ("invitations"."last_shared_at" IS NULL)),
	CONSTRAINT "invitations_open_consistent" CHECK (("invitations"."open_count" = 0) = ("invitations"."opened_at" IS NULL)
       AND ("invitations"."opened_at" IS NULL) = ("invitations"."last_opened_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"type" "message_type" NOT NULL,
	"locale" "locale" NOT NULL,
	"body" text NOT NULL,
	"updated_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_one" UNIQUE("event_id","type","locale"),
	CONSTRAINT "message_templates_body" CHECK (char_length("message_templates"."body") BETWEEN 1 AND 1000 AND position('{link}' in "message_templates"."body") > 0)
);
--> statement-breakpoint
CREATE TABLE "rsvps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"status" "rsvp_status" DEFAULT 'pending' NOT NULL,
	"companion_count" smallint DEFAULT 0 NOT NULL,
	"responded_at" timestamp with time zone,
	"last_actor_type" "actor_type",
	"last_actor_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rsvps_guest_once" UNIQUE("guest_id"),
	CONSTRAINT "rsvps_companions_range" CHECK ("rsvps"."companion_count" BETWEEN 0 AND 20),
	CONSTRAINT "rsvps_companions_only_confirmed" CHECK ("rsvps"."status" = 'confirmed' OR "rsvps"."companion_count" = 0),
	CONSTRAINT "rsvps_responded_consistent" CHECK (("rsvps"."status" = 'pending') = ("rsvps"."responded_at" IS NULL)),
	CONSTRAINT "rsvps_actor_consistent" CHECK (("rsvps"."status" = 'pending') = ("rsvps"."last_actor_type" IS NULL)
       AND ("rsvps"."last_actor_membership_id" IS NULL OR "rsvps"."last_actor_type" = 'member'))
);
--> statement-breakpoint
ALTER TABLE "guest_passes" ADD CONSTRAINT "guest_passes_replaced_by_pass_id_guest_passes_id_fk" FOREIGN KEY ("replaced_by_pass_id") REFERENCES "public"."guest_passes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_passes" ADD CONSTRAINT "guest_passes_guest_fk" FOREIGN KEY ("event_id","guest_id") REFERENCES "public"."guests"("event_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_designs" ADD CONSTRAINT "invitation_designs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_designs" ADD CONSTRAINT "invitation_designs_updated_by_membership_id_event_memberships_id_fk" FOREIGN KEY ("updated_by_membership_id") REFERENCES "public"."event_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_guest_fk" FOREIGN KEY ("event_id","guest_id") REFERENCES "public"."guests"("event_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_updated_by_membership_id_event_memberships_id_fk" FOREIGN KEY ("updated_by_membership_id") REFERENCES "public"."event_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_last_actor_membership_id_event_memberships_id_fk" FOREIGN KEY ("last_actor_membership_id") REFERENCES "public"."event_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_guest_fk" FOREIGN KEY ("event_id","guest_id") REFERENCES "public"."guests"("event_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_passes_one_active" ON "guest_passes" USING btree ("guest_id") WHERE "guest_passes"."status" = 'active';--> statement-breakpoint
CREATE INDEX "guest_passes_guest_idx" ON "guest_passes" USING btree ("guest_id","issued_at");--> statement-breakpoint
CREATE INDEX "invitations_event_idx" ON "invitations" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "rsvps_event_status_idx" ON "rsvps" USING btree ("event_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "events_cover_image_key" ON "events" USING btree ("cover_image_key") WHERE "events"."cover_image_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "events_logo_key" ON "events" USING btree ("logo_key") WHERE "events"."logo_key" IS NOT NULL;--> statement-breakpoint
-- Public tokens: 22 base62 characters drawn from the server's cryptographic random source (the
-- random bytes of gen_random_uuid), with rejection sampling so every character is uniform.
-- The application generates tokens the same way (core/shared/tokens.ts); this is used to give
-- guests created before this migration their invitation links.
CREATE FUNCTION gp_random_token() RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  result text := '';
  bytes bytea;
  b integer;
BEGIN
  WHILE length(result) < 22 LOOP
    bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    FOR i IN 0..15 LOOP
      CONTINUE WHEN i IN (6, 8); -- version and variant bits are not random
      b := get_byte(bytes, i);
      IF b < 248 AND length(result) < 22 THEN
        result := result || substr(alphabet, (b % 62) + 1, 1);
      END IF;
    END LOOP;
  END LOOP;
  RETURN result;
END;
$$;--> statement-breakpoint
-- Companions never exceed what the guest is allowed, from either side.
CREATE FUNCTION enforce_rsvp_companions() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allowed smallint;
BEGIN
  SELECT allowed_companions INTO allowed FROM guests WHERE id = NEW.guest_id;
  IF NEW.companion_count > allowed THEN
    RAISE EXCEPTION 'companion_count % exceeds the allowance %', NEW.companion_count, allowed
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER rsvps_companions_within_allowance
  BEFORE INSERT OR UPDATE OF companion_count ON rsvps
  FOR EACH ROW EXECUTE FUNCTION enforce_rsvp_companions();--> statement-breakpoint
CREATE FUNCTION enforce_allowance_covers_rsvp() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM rsvps WHERE guest_id = NEW.id AND companion_count > NEW.allowed_companions) THEN
    RAISE EXCEPTION 'allowance is below the confirmed companions' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER guests_allowance_covers_rsvp
  BEFORE UPDATE OF allowed_companions ON guests
  FOR EACH ROW EXECUTE FUNCTION enforce_allowance_covers_rsvp();--> statement-breakpoint
-- A revoked pass stays revoked, and a pass's token and guest never change.
CREATE FUNCTION enforce_pass_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.token IS DISTINCT FROM OLD.token OR NEW.guest_id IS DISTINCT FROM OLD.guest_id
     OR NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
    RAISE EXCEPTION 'a pass cannot be reassigned' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'revoked' AND (NEW.status <> 'revoked' OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
     OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason) THEN
    RAISE EXCEPTION 'a revoked pass cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER guest_passes_immutable
  BEFORE UPDATE ON guest_passes
  FOR EACH ROW EXECUTE FUNCTION enforce_pass_immutable();--> statement-breakpoint
-- An active pass exists only for an active guest whose answer is "confirmed". Checked when the
-- transaction commits, so a change may revoke the pass and update the RSVP in either order.
CREATE FUNCTION enforce_active_pass_invariant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  -- The guest id column differs by table and is passed as the trigger argument.
  gid uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM guest_passes p
    JOIN guests g ON g.id = p.guest_id
    LEFT JOIN rsvps r ON r.guest_id = p.guest_id
    WHERE p.guest_id = gid AND p.status = 'active'
      AND (g.status <> 'active' OR r.status IS DISTINCT FROM 'confirmed')
  ) THEN
    RAISE EXCEPTION 'an active pass needs an active guest with a confirmed answer'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER guest_passes_active_invariant
  AFTER INSERT OR UPDATE ON guest_passes DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_active_pass_invariant('guest_id');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER rsvps_active_pass_invariant
  AFTER UPDATE OF status ON rsvps DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_active_pass_invariant('guest_id');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER guests_active_pass_invariant
  AFTER UPDATE OF status ON guests DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_active_pass_invariant('id');--> statement-breakpoint
-- Guests created before invitations existed get their link and a pending answer now.
INSERT INTO invitations (id, event_id, guest_id, token, created_at, updated_at)
SELECT gen_random_uuid(), g.event_id, g.id, gp_random_token(), g.created_at, now()
FROM guests g
WHERE NOT EXISTS (SELECT 1 FROM invitations i WHERE i.guest_id = g.id);--> statement-breakpoint
INSERT INTO rsvps (id, event_id, guest_id, created_at, updated_at)
SELECT gen_random_uuid(), g.event_id, g.id, g.created_at, now()
FROM guests g
WHERE NOT EXISTS (SELECT 1 FROM rsvps r WHERE r.guest_id = g.id);
