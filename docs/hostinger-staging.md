# Hostinger Cloud Startup: staging and pilot deployment plan

Status: plan only. Nothing has been provisioned or deployed. Facts about Hostinger come from its
public documentation ([Node.js web apps](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/),
[plan limits](https://www.hostinger.com/support/6976044-parameters-and-limits-of-hosting-plans-in-hostinger/),
[deploy tutorial](https://www.hostinger.com/tutorials/deploy-node-js-application)); where the
documentation is silent this plan says so. Third-party prices and features named below were not
re-checked and must be confirmed before buying.

## 1. Is `apps/web` supported?

Yes, but not through Hostinger's generated Next.js launcher: it looks for `next` next to itself, and
in this pnpm monorepo `next` lives in a linked store, so the runtime answered 503 ("Cannot find module
'next'"). The repo now builds a self-contained folder from Next.js's own standalone output instead,
and Hostinger runs that folder's `server.js` directly. Settings:

| Setting                 | Value                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Framework preset        | Other (not Next.js: that preset adds the launcher that fails)                                                                  |
| Node.js                 | 22.x (the app needs 22.12 or newer)                                                                                            |
| Package manager         | pnpm                                                                                                                           |
| Root directory          | the repository root (`./`), **not** `apps/web`: the build needs the whole monorepo                                             |
| Build command           | `pnpm run build:hostinger` (if Hostinger does not install first: `pnpm install --frozen-lockfile && pnpm run build:hostinger`) |
| Output directory        | `dist/hostinger`                                                                                                               |
| Entry file              | `server.js` inside the output directory (`dist/hostinger/server.js` if a path from the root is needed)                         |
| Start command, if asked | `node dist/hostinger/server.js`                                                                                                |

The launcher binds to `0.0.0.0`, uses the `PORT` Hostinger provides (default 3000) and ignores the
`HOSTNAME` variable (often the machine's own name, which makes the server unreachable). The folder
keeps pnpm's relative symlinks, so it must be built on the host or copied with symlinks preserved
(`cp -a`, `tar`); an upload that drops symlinks breaks it. The folder is about 57 MB.

## 2. Can `apps/worker` run reliably as a second app?

**Not established by Hostinger's documentation, so treat it as unproven and test it first.** The
documentation does not say whether a second app may be a process that only does background work,
whether an app that serves no page is restarted or marked unhealthy, or whether apps are kept
running when idle. The worker is a plain always-on Node process (`tsx src/main.ts`, `tsx` is already
a worker dependency) that opens the queue connection, runs a job every minute and serves a health
port (`WORKER_HEALTH_PORT`, default 8081). The web app also needs the worker only for the minute
tick that opens and closes check-in and archives events; the door itself works without it.

Go/no-go test before relying on it (about 30 minutes, uses no guest data): create a second Node.js
app from the same repo, build `pnpm install --frozen-lockfile`, start `pnpm --filter @gp/worker
start`, set `WORKER_HEALTH_PORT` to the port the dashboard assigns or expects, and watch the logs.
It passes if the "heartbeat" line appears every 5 minutes for 30 minutes and the app is never
restarted or reported down. If the platform insists on an HTTP response on its own port, that is
what `WORKER_HEALTH_PORT` is for (`GET /health`); no code change is needed for that.

If it fails, the smallest extra requirement is one always-on machine for the worker only: the
cheapest Hostinger KVM VPS (or any 512 MB container host) running the same start command with
the same environment. It needs outbound access to the database and nothing inbound except an
optional health port. No redesign.

## 3. External services still required

| Need                               | Why                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| Managed PostgreSQL 16              | Hostinger managed hosting offers MySQL, which this app does not use              |
| S3-compatible object storage       | Event images; the app refuses production start without it (production rule)      |
| SMTP                               | Owner/admin verification and reset email; production refuses to start without it |
| Staging subdomain DNS access       | For the HTTPS certificate, and SPF/DKIM if a mail provider is used               |
| (Only if step 2 fails) worker host | See above                                                                        |

## 4. Environment variables

Set in the dashboard, on the web app; the worker app needs the same values except where noted.

| Variable                                   | Value                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `NODE_ENV`                                 | `production` (set for running; leave unset while building)                   |
| `APP_BASE_URL`                             | `https://<staging subdomain>` (must be https)                                |
| `DATABASE_URL`                             | `postgres://user:pass@host:5432/db?sslmode=require`, the direct connection   |
| `APP_ENCRYPTION_KEY`                       | `openssl rand -base64 32`; same value on web and worker; keep a copy offline |
| `LOG_LEVEL`                                | `info`                                                                       |
| `STORAGE_DRIVER`                           | `s3`                                                                         |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`    | From the storage provider (`S3_REGION=auto` for R2)                          |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Key limited to the one bucket                                                |
| `S3_FORCE_PATH_STYLE`                      | `true`                                                                       |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`    | From the mail provider (465 with `true`, or 587 with `false`)                |
| `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`  | From the mail provider; `MAIL_FROM` on the staging domain                    |
| `TRUSTED_PROXY_HOPS`                       | `1` to start; confirm it (see limitation 3)                                  |
| `WORKER_HEALTH_PORT`                       | Worker only; see step 2                                                      |
| `ERROR_TRACKING_DSN`                       | Leave empty                                                                  |

## 5. PostgreSQL for the pilot

Recommendation: a paid, always-on plan of a managed PostgreSQL 16 service with daily backups and
TLS, using its **direct** (not pooled) connection string. The queue library and the app's row locks
work with a direct connection and are not tested through a transaction pooler. Two candidates:
Neon (paid tier with scale-to-zero turned off, otherwise the first request and the queue after an
idle period are slow) or DigitalOcean Managed PostgreSQL (always on, plain Postgres). Do not use a
free tier that pauses. Pick the region closest to Riyadh that the provider offers; the data leaves
Saudi Arabia, so use invented or consented data only until you have checked Saudi personal-data
transfer rules for the real pilot. Database size and connections are tiny: the app opens at most 10
connections per process and the worker 5.
Run migrations from a laptop or CI, not from Hostinger (no SSH): with the same `DATABASE_URL` and
`APP_ENCRYPTION_KEY`, `pnpm db:migrate`, before each release. The database must accept connections
from outside; Hostinger's outgoing addresses are not published, so rely on TLS and a long random
password instead of an address allow-list.

## 6. Object storage

Recommendation: Cloudflare R2 (S3-compatible, no download fees, small free allowance). Private
bucket, one API token limited to that bucket with read, write and delete. Endpoint
`https://<account>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=true`. The app
streams images itself, so no public bucket, CORS or signed URLs. Alternative: Backblaze B2.

## 7. SMTP

Recommendation for the pilot: a transactional provider with SMTP and a free tier (Brevo, or Resend
using its SMTP endpoint), with SPF and DKIM records added to the staging domain. Only the owner and
admin accounts receive email, a handful of messages. A mailbox on the Hostinger domain is an
acceptable fallback if your plan includes one, but the built-in server mail is capped at 10 per
minute and 100 per day and is not what `SMTP_*` uses. `pnpm pilot:check --mail-to=<your mailbox>`
proves delivery.

## 8. Hostinger setup steps

1. Create the external database, bucket and SMTP account first, and note their values (no guest data).
2. Add the staging subdomain in hPanel and point it at the web app (SSL is issued automatically).
3. Add a Node.js web app from the GitHub repository, branch `phase-5/pilot-readiness` (or `main` after
   merge), with the settings table in section 1 and the variables from section 4.
4. From a laptop or CI, run `pnpm db:migrate` against the external database, then
   `pnpm db:generate` shows no change. Redeploy.
5. Open `https://<subdomain>/api/health`; expect `{"status":"ok"}`.
6. Run `pnpm pilot:check --url=https://<subdomain> --mail-to=<mailbox>` from a machine that has the
   same variables and repository checkout. Fix every FAIL; review every WARN.
7. Run the worker test in section 2; on success keep that second app, otherwise use the fallback.
8. Create the owner account (email arrives), `pnpm admin:grant <email>` from a laptop, and enrol
   admin two-factor at once.
9. Follow section 3 of `docs/pilot-readiness.md` on a real iPhone and a real Android phone, then run
   the rehearsal with realistic data through the staging site.

## 9. Limitations caused by Cloud Startup

1. No SSH and no ability to run `npm` commands by hand: migrations, `admin:grant`, `pilot:check` and
   `restore-check.sh` run from a laptop or CI against the external services.
2. One 4 GB, 4-core allowance is shared by every app on the plan, and the plan monitors CPU, RAM and
   I/O (its documented I/O figure is 20,480 KB/s). Fine for the pilot; run the 500-guest load test
   on staging before the event and watch the dashboard for 503s.
3. The reverse proxy in front of the app is Hostinger's. `TRUSTED_PROXY_HOPS` must match how it
   writes `X-Forwarded-For`, which the documentation does not state. Check by sending
   `X-Forwarded-For: 9.9.9.9` and confirming the per-address rate limit is not keyed to 9.9.9.9
   (the readiness check cannot see this). If it cannot be made to work, keep `1` and accept that
   sign-in limits are per-proxy rather than per-person; the per-account limits still apply.
4. The proxy and platform logs may record full request paths, which contain guests' and staff
   members' secret links. Ask Hostinger whether access logs can be disabled or masked; until then use
   only invented guests on staging.
5. Long-running work (the worker) is unproven, see section 2.
6. Uploaded files must not be written to the app's disk (it is not persistent); storage is external,
   which the app already does.
7. Deployments restart the app; staff devices stay signed in (sessions live in the database) but a
   deploy during the event would interrupt scanning. Freeze deployments on event days.

## 10. Can `pilot:check` run unchanged?

Yes, from any machine with the repository, Node 22 and the same environment variables, because it
reads the environment, connects to the database and storage directly and calls the deployed URL for
the HTTPS and header checks. It cannot run on Hostinger itself (no SSH). Run it from a laptop or CI
with `NODE_ENV=production`. It does not check the worker, the proxy address header or the platform's
log settings; those are steps 2 and 9 above.
