# SkillIndiaConnect

Blue-collar recruitment platform — monorepo scaffold.

## Quickstart (new dev)

```bash
# 1. Enable corepack so pnpm is managed via packageManager field
corepack enable

# 2. Install all workspace dependencies
pnpm install

# 3. Copy env template and fill in secrets
cp .env.example .env

# 4. Start Postgres + Redis
pnpm db:up

# 5. Start all three processes (web, api, worker) with live reload
pnpm dev
```

The API will log `SkillIndiaConnect API process started on :3001`.  
The worker will log `SkillIndiaConnect Worker process started`.  
The web app will be available at http://localhost:3000.

## Health check

```
GET http://localhost:3001/health
→ { "status": "ok", "redis": "up", "timestamp": "..." }
```

## Project structure

```
apps/
  web/      Next.js 14 App Router (frontend)
  api/      NestJS 10 — two entrypoints from one codebase:
              main.api.ts    HTTP server on :3001
              main.worker.ts BullMQ consumers + cron (no HTTP)
packages/
  shared-config/    Zod env schema + validateEnv()
  shared-types/     OpenAPI-generated types (placeholder)
  resume-template/  Shared React resume component (placeholder)
e2e/        Playwright test suite
```

## Database

> **DB client generation begins in Prompt 2.** The Prisma schema shell exists at
> `apps/api/prisma/schema.prisma` but contains no models yet. Do not run
> `prisma generate` or `prisma migrate` until models are added in Prompt 2.

```bash
pnpm db:up        # start Postgres + Redis via docker compose
pnpm db:down      # stop containers
pnpm db:generate  # prisma generate (after Prompt 2 adds models)
pnpm db:migrate   # prisma migrate dev (after Prompt 2 adds models)
```

## Other commands

```bash
pnpm build        # compile all packages and apps
pnpm typecheck    # tsc --noEmit across every workspace
pnpm lint         # eslint across every workspace
pnpm test         # jest (unit tests)
pnpm test:e2e     # playwright (install browsers first: pnpm exec playwright install)
```

## Architecture constraints

- `apps/web` **must not** import `@prisma/client`, `ioredis`, or anything from `apps/api`.
  Web communicates with the API over HTTP only.
- Internal packages are consumed via `@skillindiaconnect/*` + `workspace:*` — never
  relative `../../packages/...` imports.
- The worker process (`main.worker.ts`) has **no HTTP listener**. All external sends
  (SMS, email, webhooks) happen in the worker, never in the API.
