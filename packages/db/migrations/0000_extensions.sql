-- Extensions the approved schema relies on:
--   citext  : case-insensitive email columns
--   pg_trgm : trigram index for Arabic/Latin guest name search
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
