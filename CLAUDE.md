# Working in this repository

- Follow docs/architecture.md. It records decisions the product owner approved; don't change them
  without approval, and don't expand MVP scope.
- Never add SMS, and never add email as a guest channel.
- Guest personal data (names, phones, emails, notes) and tokens must never be logged or sent to
  external tools. Use `createLogger` from `@gp/core`, which redacts them.
- Domain logic belongs in `packages/core`, not in Next.js routes or the worker.
- Database integrity rules go in SQL migrations (see README "Database changes").
- Before pushing, run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
  Database tests need `DATABASE_URL` pointing at a migrated database.
