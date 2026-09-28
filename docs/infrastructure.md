# Infrastructure

## Requirements for the Saudi region (phase 0)

The app uses no provider-specific services. Any cloud offering these **inside Saudi Arabia**
works:

| Need                                                                    | Used for                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| Managed PostgreSQL 16 with point-in-time recovery and encrypted backups | All data and the job queue                                     |
| Container runtime (two services: `web`, `worker`)                       | `docker build --target web` / `--target worker`                |
| S3-compatible object storage                                            | Cover images, short-lived import files                         |
| Secret store                                                            | `DATABASE_URL`, `APP_ENCRYPTION_KEY`, provider credentials     |
| HTTPS load balancer                                                     | Health check at `GET /api/health` (worker: `GET :8081/health`) |

Environments: `staging` and `production`, each with its own database.

## Release steps

1. Build both images from the same commit.
2. Run migrations once:
   `docker run --rm -e DATABASE_URL=… <worker-image> packages/db/node_modules/.bin/tsx packages/db/src/migrate.ts`
3. Roll out `web` and `worker`.

## Configuration

See `.env.example`. Configuration is validated at startup (`packages/core/src/config`), and the
process refuses to start with invalid values.

## Account email (owners and admins only)

Verification and password-reset emails need a transactional email provider, chosen together with
the hosting provider. Until one is configured, production drops these emails with a warning (the
log line never contains the link). Guests never receive email.
