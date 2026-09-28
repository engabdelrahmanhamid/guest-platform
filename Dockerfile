# Region-agnostic images; deployed to the Saudi cloud region chosen in phase 0.
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @gp/web build

# Web app: Next.js standalone server.
FROM node:22-alpine AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
USER app
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]

# Worker. Also runs migrations as a one-off release step:
#   docker run --rm -e DATABASE_URL=… <image> packages/db/node_modules/.bin/tsx packages/db/src/migrate.ts
FROM deps AS worker
ENV NODE_ENV=production
COPY . .
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
CMD ["apps/worker/node_modules/.bin/tsx", "apps/worker/src/main.ts"]
