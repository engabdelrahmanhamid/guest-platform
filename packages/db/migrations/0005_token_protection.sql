-- Invitation and pass tokens are bearer credentials: from here on the database holds only their
-- SHA-256 (`token_hash`, unique, used for lookup) and the token encrypted with APP_ENCRYPTION_KEY
-- (`token_enc`, AES-256-GCM bound to the row), never the token itself.
--
-- SQL can't encrypt with the app key, so rows that already exist are encrypted by the migration
-- runner (packages/db/src/migrate.ts) just before this file runs: it writes each row's ciphertext
-- to gp_sealed_tokens, which this migration moves into place and then drops. If any row has no
-- ciphertext, the migration stops and changes nothing, so a plain-text token is never dropped
-- without its encrypted copy.
CREATE TABLE IF NOT EXISTS "gp_sealed_tokens" (
	"kind" text NOT NULL,
	"id" uuid NOT NULL,
	"token_enc" bytea NOT NULL,
	PRIMARY KEY ("kind", "id")
);--> statement-breakpoint
ALTER TABLE "guest_passes" ADD COLUMN "token_hash" bytea;--> statement-breakpoint
ALTER TABLE "guest_passes" ADD COLUMN "token_enc" bytea;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "token_hash" bytea;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "token_enc" bytea;--> statement-breakpoint
-- The pass trigger guards the stored token by its hash and ciphertext from now on.
CREATE OR REPLACE FUNCTION enforce_pass_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- (The stored token is set once, by this migration, and never changes after.)
  IF (OLD.token_hash IS NOT NULL AND NEW.token_hash IS DISTINCT FROM OLD.token_hash)
     OR (OLD.token_enc IS NOT NULL AND NEW.token_enc IS DISTINCT FROM OLD.token_enc)
     OR NEW.guest_id IS DISTINCT FROM OLD.guest_id OR NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
    RAISE EXCEPTION 'a pass cannot be reassigned' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'revoked' AND (NEW.status <> 'revoked' OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
     OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason) THEN
    RAISE EXCEPTION 'a revoked pass cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
UPDATE "guest_passes" p
SET "token_hash" = sha256(convert_to(p."token", 'UTF8')), "token_enc" = s."token_enc"
FROM "gp_sealed_tokens" s
WHERE s."kind" = 'pass' AND s."id" = p."id";--> statement-breakpoint
UPDATE "invitations" i
SET "token_hash" = sha256(convert_to(i."token", 'UTF8')), "token_enc" = s."token_enc"
FROM "gp_sealed_tokens" s
WHERE s."kind" = 'invitation' AND s."id" = i."id";--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "invitations" WHERE "token_enc" IS NULL)
     OR EXISTS (SELECT 1 FROM "guest_passes" WHERE "token_enc" IS NULL) THEN
    RAISE EXCEPTION 'existing invitation or pass tokens were not encrypted. Run migrations with packages/db/src/migrate.ts and APP_ENCRYPTION_KEY set.';
  END IF;
END;
$$;--> statement-breakpoint
DROP TABLE "gp_sealed_tokens";--> statement-breakpoint
-- Run the deferred pass checks the updates above queued, so the tables can be altered below.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "guest_passes" DROP CONSTRAINT "guest_passes_token";--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_token";--> statement-breakpoint
ALTER TABLE "guest_passes" DROP CONSTRAINT "guest_passes_token_format";--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_token_format";--> statement-breakpoint
ALTER TABLE "guest_passes" DROP COLUMN "token";--> statement-breakpoint
ALTER TABLE "invitations" DROP COLUMN "token";--> statement-breakpoint
ALTER TABLE "guest_passes" ALTER COLUMN "token_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_passes" ALTER COLUMN "token_enc" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "token_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "token_enc" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_passes" ADD CONSTRAINT "guest_passes_token_hash" UNIQUE("token_hash");--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_token_hash" UNIQUE("token_hash");--> statement-breakpoint
ALTER TABLE "guest_passes" ADD CONSTRAINT "guest_passes_token_hash_len" CHECK (octet_length("guest_passes"."token_hash") = 32);--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_token_hash_len" CHECK (octet_length("invitations"."token_hash") = 32);--> statement-breakpoint
-- Tokens are now made only by the application, which encrypts them before storing.
DROP FUNCTION gp_random_token();
