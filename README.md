# Guest Platform

Guest Experience & Event Operations Platform: guest lifecycle management for private and
business events (invitations, RSVP, QR passes, check-in, live attendance, reports).
Arabic-first.

- Approved architecture: [docs/architecture.md](docs/architecture.md)
- Infrastructure and releases: [docs/infrastructure.md](docs/infrastructure.md)

## Local development

Requirements: Node 22.12+, pnpm 10 (`corepack enable`), Docker (or a local PostgreSQL 16).

```sh
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm db:migrate
pnpm dev            # web on http://localhost:3000, worker alongside
```

The dev scripts don't load `.env` automatically. Export the variables in your shell first
(for example with `set -a; . ./.env; set +a`). Generate `APP_ENCRYPTION_KEY` with
`openssl rand -base64 32`. Don't export `NODE_ENV=development` when running `pnpm build`.

- Account emails (verification, password reset) are not sent in development; open
  http://localhost:3000/dev/outbox to follow their links.
- To make an account a platform admin: `pnpm admin:grant <email>`. The admin enrolls two-factor
  authentication at `/admin/mfa` on first visit.
- Worker health: `GET http://localhost:8081/health` (`WORKER_HEALTH_PORT`).

### Demo data for product review

`pnpm demo:seed` fills an empty database with a demo owner that has one event in each lifecycle
state (draft, active, live, completed, cancelled, archived) plus staff, and a demo platform admin.
Use a separate database so test accounts don't show up in the screens. It refuses to run in
production and does nothing if the demo accounts already exist.

| Account         | Password           | Notes                                    |
| --------------- | ------------------ | ---------------------------------------- |
| owner@demo.test | `demo-review-2026` | Event owner                              |
| admin@demo.test | `demo-review-2026` | Platform admin; enrolls 2FA on first use |

## Checks

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Database tests run against `DATABASE_URL` (migrated) and are skipped without it. They isolate
themselves with unique accounts rather than truncating tables.

## Layout

```
apps/web         Next.js: owner app, guest pages, staff scanner, admin, API
apps/worker      Background jobs (pg-boss)
packages/core    Domain logic, config, logging (framework-free)
packages/db      Drizzle schema, SQL migrations, migration runner
```

## Database changes

Edit `packages/db/src/schema`, then run `pnpm db:generate`. Rules Drizzle can't express (partial
unique indexes, composite foreign keys, CHECK constraints, triggers) go into the generated SQL
migration or a `--custom` one, and are reviewed like code. CI fails if the schema and migrations
drift apart.
