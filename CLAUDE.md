# SkillIndiaConnect — Engineering Guide for Claude Code

SkillIndiaConnect is a production blue-collar recruitment platform connecting
skilled workers in India with employers in the Gulf and locally. Read this fully
before writing code. The enforced rules live in `.claude/rules/` — consult the
relevant file before touching that area.

## Architecture invariants (never violate)

- **Monorepo** (pnpm workspaces): `apps/web` (Next.js 14), `apps/api` (NestJS),
  `packages/*` (`@skillindiaconnect/*`).
- **`apps/web` is HTTP-only.** It NEVER imports `@prisma/client`, `ioredis`, or
  anything from `apps/api`. It talks to the API over HTTP. (Lint-enforced.)
- **NestJS modular monolith, TWO processes from ONE codebase**: an API process
  (`main.api.ts`, HTTP) and a WORKER process (`main.worker.ts`, BullMQ + cron, no
  HTTP). The worker root must not load controllers; the API root must not load
  cron consumers.
- **All external sends (Meta WhatsApp, AWS SES) and heavy/async work happen in
  the WORKER**, never inline in the API. The API writes state + enqueues. See
  `worker-and-external-sends.md`.
- **Cron only enqueues deterministic-jobId BullMQ jobs**, never works inline. See
  `cron-queue-dedupe.md`.
- **Prisma migrate is the only schema path.** Raw-SQL migrations are reviewed
  line-by-line; breaking changes use expand→backfill→contract. See `migrations.md`.

## API invariants

- Routes under `/api/v1`; `/health` is unversioned. See `api-conventions.md` for
  the response/error envelopes, pagination modes, rate limits, idempotency, and
  webhook handling.

## Security & privacy invariants

- **Viewer-aware DTO mappers enforce privacy at the API layer** — never rely on
  the UI to hide fields. See `viewer-aware-dto.md`.
- No PII in logs or Sentry (passport numbers, phone, email, tokens, OTPs,
  document URLs). Redaction applies in loggers AND Sentry `beforeSend`.
- Document URLs are short-expiry signed R2 URLs; every issuance is audited.
- Financial tables (orders, payments, subscriptions, invoices) and `audit_logs`
  are never cascade-deleted.

## Business-rule invariants (enforced server-side, not just UI)

- A job cannot publish with accommodation / health insurance / transportation =
  false (rules read from Settings, Super-Admin gated).
- Application state machine: employers move status FORWARD only
  (PENDING→SHORTLISTED→SELECTED/REJECTED); only admins do corrective/backward
  moves, with a mandatory reason logged as ADMIN_OVERRIDE.
- The "Selected" WhatsApp fires once per application (guarded by
  `selectedNotifiedAt`); re-entry sends email + in-app only.
- Profile completion is computed server-side, stored, single-source, identical
  everywhere. Apply requires completion ≥ threshold AND all mandatory documents
  AND passport not expired.
- Match score is computed once at apply time, clamped, snapshotted into
  `matchBreakdown`, and never recomputed.
- Subscription quota enforced at publish (Free = 1 active job).
- One email = one role. Google OAuth for candidates only.

## How we work

- One reviewable unit per change; small PRs. Raw-SQL migrations reviewed line by
  line. Verify `prisma migrate diff` is clean after any migration.
- Tests accompany code; the E2E suite (Playwright, `e2e/`) is a merge gate and
  grows each sprint. Candidate-facing screens also run under the
  `android-constrained` profile.

## Commands

`pnpm dev` (web + api + worker) · `pnpm build` · `pnpm lint` · `pnpm typecheck` ·
`pnpm test` · `pnpm test:e2e` · `pnpm db:up` / `pnpm db:down`
DB client generation: `pnpm --filter ./apps/api exec prisma generate`.
