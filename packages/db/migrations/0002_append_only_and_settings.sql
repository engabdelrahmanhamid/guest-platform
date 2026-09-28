-- Audit tables are append-only: history is never edited or removed by the application.
CREATE FUNCTION forbid_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER activity_append_only
  BEFORE UPDATE OR DELETE ON activity
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();--> statement-breakpoint
CREATE TRIGGER admin_audit_log_append_only
  BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();--> statement-breakpoint
-- Platform defaults. Admins change them through the app (audited); events copy the
-- lifecycle values at creation, so later changes never rewrite existing events.
INSERT INTO platform_settings (key, value) VALUES
  ('lifecycle.auto_open_checkin', 'true'),
  ('lifecycle.checkin_opens_offset_min', '-180'),
  ('lifecycle.assumed_duration_min', '360'),
  ('lifecycle.auto_close_checkin', 'true'),
  ('lifecycle.checkin_closes_offset_min', '360'),
  ('lifecycle.reopen_window_min', '2880'),
  ('auto_archive.days', '90'),
  ('retention.guest_pii_days', 'null')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
-- The event state machine, enforced in the database as well as in the domain services, so no
-- code path can make a transition the product doesn't allow. Must match core/events/lifecycle.ts.
CREATE FUNCTION enforce_event_status_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF (OLD.status, NEW.status) IN (
    ('draft', 'active'),
    ('active', 'live'),
    ('active', 'cancelled'),
    ('live', 'completed'),
    ('live', 'cancelled'),
    ('completed', 'live'),
    ('completed', 'archived'),
    ('cancelled', 'archived')
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid event status transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'check_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER events_status_transition
  BEFORE UPDATE OF status ON events
  FOR EACH ROW EXECUTE FUNCTION enforce_event_status_transition();