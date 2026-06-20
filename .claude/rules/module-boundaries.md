# Module boundaries

NestJS modules: Auth, Candidate (with a Resume submodule), Employer, Jobs,
Applications, Admin, Payments, Notifications, Settings — plus infrastructure:
Core (config, Prisma, Redis), Audit, Queue.

## Rule 1 — web is HTTP-only (LINT-ENFORCED)
`apps/web` never imports `@prisma/client`, `ioredis`, or anything in `apps/api`.
It consumes the API over HTTP.

## Rule 2 — no escaping a package (LINT-ENFORCED)
Import internal packages via `@skillindiaconnect/*`, never relative
`../../packages/...`. Entrypoints (`main.api`, `main.worker`) are never imported.

## Rule 3 — modules don't reach into each other (lint scaffold + convention)
A module imports only: its own files, Core/shared infrastructure, and other
modules' PUBLIC service exports. Never another module's controllers,
repositories, or internal providers. Cross-module side effects travel via:
- `EventEmitter2` domain events for same-process, same-transaction-adjacent
  reactions, or
- BullMQ for anything external or retryable.
This is enforced by `import/no-restricted-paths` zones in the api ESLint config.
**When you create a new module, add it as a zone** (one line per module; see the
example in `.eslintrc.cjs`). If per-zone maintenance becomes tedious (~3+
modules), migrate to `eslint-plugin-boundaries` (one element-type rule that
auto-applies to every module).

## Rule 4 — a module owns its tables (REVIEW-ENFORCED, not lintable)
A module reads/writes ONLY its own tables, through its own `PrismaService` usage.
It does not query another module's tables — it calls that module's service.
This is NOT fully lintable (all modules share one `PrismaService`), so it is
enforced in code review. Treat a cross-table query in the wrong module as a bug.

Why all this: clear ownership and a cheap Phase-2 extraction path (e.g. pulling
Notifications into its own service) without untangling hidden coupling.
