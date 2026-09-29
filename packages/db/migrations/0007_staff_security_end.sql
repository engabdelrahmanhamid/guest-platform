-- Phase 5: an admin disabling an event ends its staff device sessions for good (reason `security`).
ALTER TYPE "public"."staff_session_end_reason" ADD VALUE 'security';--> statement-breakpoint
-- Ending a staff session or revoking an access link is permanent. Nothing may clear or change the
-- end/revoke marker afterwards, so reopening an event, a bug or a manual fix can never bring back
-- a device the owner or an admin shut out. Sessions that were only paused (the event completed)
-- were never ended, and stay usable when the event reopens.
CREATE FUNCTION forbid_unending() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'staff_sessions' THEN
    IF OLD.ended_at IS NOT NULL AND (NEW.ended_at IS DISTINCT FROM OLD.ended_at
        OR NEW.end_reason IS DISTINCT FROM OLD.end_reason) THEN
      RAISE EXCEPTION 'an ended staff session cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSIF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'a revoked access link cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER staff_sessions_ended_is_final
  BEFORE UPDATE ON staff_sessions
  FOR EACH ROW EXECUTE FUNCTION forbid_unending();--> statement-breakpoint
CREATE TRIGGER staff_access_links_revoked_is_final
  BEFORE UPDATE ON staff_access_links
  FOR EACH ROW EXECUTE FUNCTION forbid_unending();
