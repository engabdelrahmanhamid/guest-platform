-- Phase 4: staff access links and device sessions, the append-only check-in ledger and the
-- attendance projection it maintains. Rules that keep attendance honest are enforced here, not
-- only in the application (see the functions at the end).
CREATE TYPE "public"."check_in_action" AS ENUM('check_in', 'correction', 'walk_in');--> statement-breakpoint
CREATE TYPE "public"."check_in_method" AS ENUM('qr', 'search', 'walk_in', 'dashboard');--> statement-breakpoint
CREATE TYPE "public"."staff_session_end_reason" AS ENUM('revoked', 'resent', 'member_removed', 'signed_out');--> statement-breakpoint
CREATE TABLE "attendance" (
	"guest_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"checked_in_count" smallint NOT NULL,
	"first_check_in_at" timestamp with time zone,
	"last_check_in_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "attendance_count_range" CHECK ("attendance"."checked_in_count" BETWEEN 0 AND 21)
);--> statement-breakpoint
CREATE TABLE "check_in_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"action" "check_in_action" NOT NULL,
	"method" "check_in_method" NOT NULL,
	"count_delta" smallint NOT NULL,
	"resulting_count" smallint NOT NULL,
	"reason" text,
	"pass_id" uuid,
	"actor_membership_id" uuid NOT NULL,
	"staff_session_id" uuid,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "check_in_logs_idempotency_key" UNIQUE("idempotency_key"),
	CONSTRAINT "check_in_logs_delta_nonzero" CHECK ("check_in_logs"."count_delta" <> 0),
	CONSTRAINT "check_in_logs_resulting_range" CHECK ("check_in_logs"."resulting_count" BETWEEN 0 AND 21),
	CONSTRAINT "check_in_logs_only_corrections_subtract" CHECK ("check_in_logs"."count_delta" > 0 OR "check_in_logs"."action" = 'correction'),
	CONSTRAINT "check_in_logs_correction_reason" CHECK (("check_in_logs"."action" = 'correction') = ("check_in_logs"."reason" IS NOT NULL)),
	CONSTRAINT "check_in_logs_reason_len" CHECK ("check_in_logs"."reason" IS NULL OR char_length("check_in_logs"."reason") BETWEEN 1 AND 300),
	CONSTRAINT "check_in_logs_method_matches" CHECK (("check_in_logs"."method" = 'qr') = ("check_in_logs"."pass_id" IS NOT NULL)
       AND ("check_in_logs"."action" = 'walk_in') = ("check_in_logs"."method" = 'walk_in'))
);--> statement-breakpoint
CREATE TABLE "staff_access_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redeemed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "staff_access_links_token_hash" UNIQUE("token_hash"),
	CONSTRAINT "staff_access_links_token_hash_len" CHECK (octet_length("staff_access_links"."token_hash") = 32),
	CONSTRAINT "staff_access_links_used_once" CHECK ("staff_access_links"."redeemed_at" IS NULL OR "staff_access_links"."revoked_at" IS NULL OR "staff_access_links"."revoked_at" >= "staff_access_links"."redeemed_at")
);--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"device_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" "staff_session_end_reason",
	"ended_by_membership_id" uuid,
	CONSTRAINT "staff_sessions_token_hash" UNIQUE("token_hash"),
	CONSTRAINT "staff_sessions_link_once" UNIQUE("link_id"),
	CONSTRAINT "staff_sessions_token_hash_len" CHECK (octet_length("staff_sessions"."token_hash") = 32),
	CONSTRAINT "staff_sessions_ended_consistent" CHECK (("staff_sessions"."ended_at" IS NULL) = ("staff_sessions"."end_reason" IS NULL)),
	CONSTRAINT "staff_sessions_device_label_len" CHECK ("staff_sessions"."device_label" IS NULL OR char_length("staff_sessions"."device_label") <= 80)
);--> statement-breakpoint
ALTER TABLE "event_memberships" ADD CONSTRAINT "event_memberships_event_id_id" UNIQUE("event_id","id");--> statement-breakpoint
ALTER TABLE "guest_passes" ADD CONSTRAINT "guest_passes_guest_id_id" UNIQUE("guest_id","id");--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_guest_fk" FOREIGN KEY ("event_id","guest_id") REFERENCES "public"."guests"("event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_logs" ADD CONSTRAINT "check_in_logs_staff_session_id_staff_sessions_id_fk" FOREIGN KEY ("staff_session_id") REFERENCES "public"."staff_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_logs" ADD CONSTRAINT "check_in_logs_guest_fk" FOREIGN KEY ("event_id","guest_id") REFERENCES "public"."guests"("event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_logs" ADD CONSTRAINT "check_in_logs_pass_fk" FOREIGN KEY ("guest_id","pass_id") REFERENCES "public"."guest_passes"("guest_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_logs" ADD CONSTRAINT "check_in_logs_actor_fk" FOREIGN KEY ("event_id","actor_membership_id") REFERENCES "public"."event_memberships"("event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_access_links" ADD CONSTRAINT "staff_access_links_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_access_links" ADD CONSTRAINT "staff_access_links_created_by_membership_id_event_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."event_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_access_links" ADD CONSTRAINT "staff_access_links_membership_fk" FOREIGN KEY ("event_id","membership_id") REFERENCES "public"."event_memberships"("event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_link_id_staff_access_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."staff_access_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_ended_by_membership_id_event_memberships_id_fk" FOREIGN KEY ("ended_by_membership_id") REFERENCES "public"."event_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_membership_fk" FOREIGN KEY ("event_id","membership_id") REFERENCES "public"."event_memberships"("event_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_event_idx" ON "attendance" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "check_in_logs_event_idx" ON "check_in_logs" USING btree ("event_id","id");--> statement-breakpoint
CREATE INDEX "check_in_logs_guest_idx" ON "check_in_logs" USING btree ("guest_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_access_links_one_open" ON "staff_access_links" USING btree ("membership_id") WHERE "staff_access_links"."redeemed_at" IS NULL AND "staff_access_links"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "staff_sessions_membership_idx" ON "staff_sessions" USING btree ("membership_id");--> statement-breakpoint
-- The ledger is append-only: corrections are new rows, never edits.
CREATE TRIGGER check_in_logs_append_only
  BEFORE UPDATE OR DELETE ON check_in_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();--> statement-breakpoint
-- Every ledger row is checked against the guest and the event and then applied to `attendance`
-- in the same statement, so the projection can never drift from the ledger:
--   * check-ins and walk-ins only while the event is live; corrections while live or completed
--   * resulting_count must equal the current count plus the delta
--   * adding people never passes the expected party size (active guest, confirmed answer:
--     1 + companions; otherwise 0)
--   * a QR check-in names an active pass of this guest
-- Callers lock the guest row first, so two scanners are serialized before they get here.
CREATE FUNCTION apply_check_in() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ev_status event_status;
  ev_disabled timestamptz;
  current_count smallint;
  expected integer;
BEGIN
  SELECT status, disabled_at INTO ev_status, ev_disabled FROM events WHERE id = NEW.event_id;
  IF ev_disabled IS NOT NULL
     OR (NEW.action <> 'correction' AND ev_status <> 'live')
     OR (NEW.action = 'correction' AND ev_status NOT IN ('live', 'completed')) THEN
    RAISE EXCEPTION 'check-in is closed for this event' USING ERRCODE = 'check_violation';
  END IF;
  SELECT checked_in_count INTO current_count FROM attendance WHERE guest_id = NEW.guest_id FOR UPDATE;
  current_count := coalesce(current_count, 0);
  IF NEW.resulting_count <> current_count + NEW.count_delta THEN
    RAISE EXCEPTION 'resulting_count must follow the ledger' USING ERRCODE = 'check_violation';
  END IF;
  SELECT CASE WHEN g.status = 'active' AND r.status = 'confirmed' THEN 1 + r.companion_count ELSE 0 END
    INTO expected
    FROM guests g JOIN rsvps r ON r.guest_id = g.id
    WHERE g.id = NEW.guest_id AND g.event_id = NEW.event_id;
  IF NEW.count_delta > 0 AND NEW.resulting_count > coalesce(expected, 0) THEN
    RAISE EXCEPTION 'check-in would pass the expected party size' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.pass_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM guest_passes WHERE id = NEW.pass_id AND status = 'active') THEN
    RAISE EXCEPTION 'the pass is not active' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO attendance AS a (guest_id, event_id, checked_in_count, first_check_in_at, last_check_in_at, updated_at)
  VALUES (NEW.guest_id, NEW.event_id, NEW.resulting_count,
          CASE WHEN NEW.resulting_count > 0 THEN NEW.created_at END,
          CASE WHEN NEW.resulting_count > 0 THEN NEW.created_at END,
          NEW.created_at)
  ON CONFLICT (guest_id) DO UPDATE SET
    checked_in_count = NEW.resulting_count,
    first_check_in_at = CASE WHEN NEW.resulting_count = 0 THEN NULL
                             ELSE coalesce(a.first_check_in_at, NEW.created_at) END,
    last_check_in_at = CASE WHEN NEW.resulting_count = 0 THEN NULL
                            WHEN NEW.count_delta > 0 THEN NEW.created_at
                            ELSE a.last_check_in_at END,
    updated_at = NEW.created_at;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER check_in_logs_apply
  BEFORE INSERT ON check_in_logs
  FOR EACH ROW EXECUTE FUNCTION apply_check_in();--> statement-breakpoint
-- `attendance` is written only by the ledger trigger above.
CREATE FUNCTION forbid_direct_attendance_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'attendance changes only through check_in_logs' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint
CREATE TRIGGER attendance_ledger_only
  BEFORE INSERT OR UPDATE OR DELETE ON attendance
  FOR EACH ROW EXECUTE FUNCTION forbid_direct_attendance_write();--> statement-breakpoint
-- Once people are inside, the guest's party can't shrink below them: no decline, no smaller
-- party, and no cancelling the guest. (A correction brings the count down first.)
CREATE FUNCTION enforce_party_covers_attendance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  inside smallint;
  party integer;
BEGIN
  SELECT checked_in_count INTO inside FROM attendance WHERE guest_id = NEW.guest_id;
  IF coalesce(inside, 0) = 0 THEN
    RETURN NEW;
  END IF;
  party := CASE WHEN NEW.status = 'confirmed' THEN 1 + NEW.companion_count ELSE 0 END;
  IF party < inside THEN
    RAISE EXCEPTION 'the party is smaller than the people already checked in' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER rsvps_party_covers_attendance
  BEFORE UPDATE OF status, companion_count ON rsvps
  FOR EACH ROW EXECUTE FUNCTION enforce_party_covers_attendance();--> statement-breakpoint
CREATE FUNCTION forbid_cancel_after_check_in() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled'
     AND EXISTS (SELECT 1 FROM attendance WHERE guest_id = NEW.id AND checked_in_count > 0) THEN
    RAISE EXCEPTION 'a guest who has checked in cannot be cancelled' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER guests_no_cancel_after_check_in
  BEFORE UPDATE OF status ON guests
  FOR EACH ROW EXECUTE FUNCTION forbid_cancel_after_check_in();--> statement-breakpoint
-- A live event can be cancelled only while nobody is inside; after that it happened.
CREATE FUNCTION forbid_cancel_with_arrivals() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status = 'live'
     AND EXISTS (SELECT 1 FROM attendance WHERE event_id = NEW.id AND checked_in_count > 0) THEN
    RAISE EXCEPTION 'an event with arrivals cannot be cancelled' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER events_no_cancel_with_arrivals
  BEFORE UPDATE OF status ON events
  FOR EACH ROW EXECUTE FUNCTION forbid_cancel_with_arrivals();
