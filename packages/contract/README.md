# @skillindiaconnect/contract

OpenAPI 3.1 specification for the SkillIndiaConnect API.
This is the **source of truth** for the API contract. Backend and frontend build
in parallel against it.

## Files

| File | Purpose |
|------|---------|
| `openapi.yaml` | The OpenAPI 3.1 spec — **edit here, nowhere else** |

## Regenerating types and mocks

After any change to `openapi.yaml`, run from the monorepo root:

```bash
pnpm contract:generate
```

This runs two steps in sequence:
1. **`pnpm --filter @skillindiaconnect/contract validate`** — lints `openapi.yaml`
   with Redocly CLI; fails fast on spec errors.
2. **`pnpm --filter @skillindiaconnect/shared-types generate`** — runs
   `openapi-typescript` to regenerate `packages/shared-types/src/generated/api.ts`.

The generated file is committed alongside the spec change. MSW handlers are
hand-written and must be updated manually when the spec changes.

## Freeze rule

> **After the initial freeze merge, the contract is frozen.**
> Any change to `openapi.yaml` requires:
> 1. Edit the spec.
> 2. Run `pnpm contract:generate` (linting + type generation must be clean).
> 3. Update any MSW handlers in `apps/web/src/mocks/handlers.ts` that reference
>    the changed endpoints.
> 4. Include a versioned amendment description in the PR body describing what
>    changed and why.
>
> Do NOT hand-edit `packages/shared-types/src/generated/api.ts` — it is
> overwritten by generation.

## Spec conventions

- **Base URL:** `/api/v1` for all versioned endpoints; `/health` is unversioned.
- **Success envelope:** `{ data: ... }`. Offset lists add
  `meta: { page, pageSize, total, totalPages }`. Cursor feeds use
  `{ data: [...], nextCursor: string | null }`.
- **Error envelope:** `{ type, title, status, detail, code, meta? }` — the
  `code` field is the machine-readable contract field (e.g. `EMAIL_TAKEN`).
- **Enumeration-safe endpoints:** `POST /auth/login/phone/start` and
  `POST /auth/forgot-password` always return 200 regardless of whether an
  account exists. **Never add a branch on the response body.**
- **Stubs (later sprints):** Paths marked `[S3]`/`[S4]`/etc. return
  `501 NOT_IMPLEMENTED`. They exist so the full API surface is navigable.

## Validating the spec manually

```bash
pnpm --filter @skillindiaconnect/contract validate
# or, from this directory:
npx @redocly/cli lint openapi.yaml
```
