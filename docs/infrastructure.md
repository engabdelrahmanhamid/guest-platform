# Infrastructure

## Requirements for the Saudi region (phase 0)

The app uses no provider-specific services. Any cloud offering these **inside Saudi Arabia**
works:

| Need                                                                    | Used for                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| Managed PostgreSQL 16 with point-in-time recovery and encrypted backups | All data and the job queue                                     |
| Container runtime (two services: `web`, `worker`)                       | `docker build --target web` / `--target worker`                |
| S3-compatible object storage (private bucket)                           | Invitation cover images and logos                              |
| Secret store                                                            | `DATABASE_URL`, `APP_ENCRYPTION_KEY`, provider credentials     |
| HTTPS load balancer                                                     | Health check at `GET /api/health` (worker: `GET :8081/health`) |

Environments: `staging` and `production`, each with its own database.

## Release steps

1. Build both images from the same commit.
2. Run migrations once, with the same key the app uses (the runner encrypts stored invitation and
   pass tokens when a migration needs it; see "Token storage" in architecture.md):
   `docker run --rm -e DATABASE_URL=… -e APP_ENCRYPTION_KEY=… <worker-image> packages/db/node_modules/.bin/tsx packages/db/src/migrate.ts`
3. Roll out `web` and `worker`.

## Configuration

See `.env.example`. Configuration is validated at startup (`packages/core/src/config`), and the
process refuses to start with invalid values.

## Account email (owners and admins only)

Verification and password-reset emails go over SMTP, so any transactional email provider hosted
in the Saudi region works without a code change. Set `SMTP_HOST`, `SMTP_PORT` (465 with
`SMTP_SECURE=true`, or 587 with `SMTP_SECURE=false` for STARTTLS, which is then required),
`SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM`. Production refuses to start without them. Use a
sending domain with SPF, DKIM and DMARC set up, or messages land in spam. A failed send is logged
by kind and error code only (never the address or the link) and is not shown to the person, so a
reset can't be used to find out which addresses have accounts; the person asks again. Guests never
receive email. `pnpm pilot:check --mail-to=<owner mailbox>` proves delivery end to end.

## Reverse proxy and client addresses

Rate limits on sign-in, sign-up, password reset and the public invitation pages are keyed by
client address. Set `TRUSTED_PROXY_HOPS` to the number of proxies in front of the web app that
**append** to `X-Forwarded-For` (1 for a single load balancer; 0 if the app is reached directly,
which turns per-address limits off). The address is read that many places from the right, so a
client-supplied header is ignored, but only if your load balancer appends to the header instead of
passing it through. Also configure the proxy and any CDN not to write full request paths to access
logs, or to mask `/i/*`, `/s/*` and `/api/v1/public/i/*`: those paths contain the guests' and
staff members' secret links.

The app refuses to start with `NODE_ENV` other than `production` when `APP_BASE_URL` is https, so a
staging copy can't run in development mode on a public address (development mode shows account
links at `/dev/outbox` and weakens cookies).

## Object storage (phase 3)

Set `STORAGE_DRIVER=s3` with `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY` (production refuses to start without them). The bucket stays private: the
web app streams images to browsers after its own access check, so no public bucket policy, CORS
rule or signed URL is needed. Give the key read, write and delete on the bucket only. Development
uses `STORAGE_DRIVER=local`, which writes to `LOCAL_STORAGE_DIR` (default `.data/storage`).

## Backups and restore

Use the provider's managed PostgreSQL with point-in-time recovery and encrypted backups. A backup
that has never been restored is not a backup: `scripts/restore-check.sh` dumps a database, restores
it into a scratch database, compares the row count of every table, re-checks that the attendance
totals still equal the check-in ledger and that the ledger still refuses edits, then deletes the
scratch database. Run it against staging before the pilot and after any schema change, and also
restore a real provider snapshot into a separate instance once. Keep dumps out of shared folders
(they hold guest personal data); the script writes to a private temporary directory and removes it.

## Readiness check

`pnpm pilot:check [--url=https://…] [--mail-to=…]` runs against a deployed environment with the
same variables as the app: configuration, database, migrations applied, encryption key opens stored
tokens, object storage write/read/delete, SMTP credentials, log redaction, HTTPS health, security
headers, and that guest and door pages are private. It exits non-zero on a failure and prints
warnings for things a person must confirm. See `docs/pilot-readiness.md`.
