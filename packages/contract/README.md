# @skillindiaconnect/contract

OpenAPI 3.1 specification for the SkillIndiaConnect API.
This is the **source of truth** for the API contract. Backend and frontend build
in parallel against it.

## Sprint history

| Version | Sprint | Additions                                                                                                                                               |
| ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1.0   | S1-0   | Auth, candidate profile, onboarding, resume (settings/generate/download/send)                                                                           |
| 0.2.0   | S2-0   | Employer identity (company + docs), jobs CRUD + lifecycle, public job search, candidate notifications, admin employer approval, admin platform settings |
| 0.3.0   | S3-0   | Employer profile (hiring prefs, contacts, logo), S3 dashboard shape (totalJobViews, hiredThisMonth, profileChecklist), employer-views-candidate (CandidateEmployerView), minimal candidate browse (CandidateBrowseCard), profile-view analytics (ProfileViewsSummary) |
| 0.4.0   | S4-0   | Applications: apply-gate ladder (`POST /jobs/{id}/apply`), match snapshot (`matchScore` + `MatchBreakdown`), forward-only state machine (`PATCH /applications/{id}/status`), admin corrective override (`PATCH /admin/applications/{id}/status`), candidate reads (`/candidates/me/applications`, `/candidates/me/applications/{id}` with timeline), employer applicant list + counts (`GET /jobs/{id}/applicants`), admin table (`GET /admin/applications`). Promoted S2/S3 honest-zeros to live: `EmployerDashboardKpi.totalApplications` / `.shortlisted`, `EmployerDashboard.recentApplicants` (now `ApplicantSummary[]`), `Job.applicantCount`. |

## Files

| File           | Purpose                                            |
| -------------- | -------------------------------------------------- |
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

The generated file is committed alongside the spec change.

## Shared-handlers rule (CRITICAL)

`apps/web/src/mocks/handlers.ts` exports a **single `handlers` array** consumed
by both the browser worker (`browser.ts` → `setupWorker(...handlers)`) and the
Node test server (`server.ts` → `setupServer(...handlers)`). Any divergence
causes handlers to work in one environment but 404 in the other.

**Every handler path must include the full `/api/v1` prefix** (via the `BASE`
constant), matching the `API_BASE = '/api/v1'` the client uses. This was the
root cause of the S1 MSW-in-browser 404 bug.

When you add a new endpoint to the spec:

1. Add its handler to `handlers.ts` using `${BASE}/your/path`.
2. Export it in the `handlers` array (not conditionally).
3. Remove it from `stubNotImplemented` if it was previously stubbed there.

## Freeze rule

> **After the initial freeze merge, the contract is frozen.**
> Any change to `openapi.yaml` requires:
>
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
- **Public endpoints:** `GET /jobs` and `GET /jobs/{id}` carry `security: []` —
  no bearer token required. `isSaved` is `null` for unauthenticated callers.
- **Publish enforcement order** (documented in both spec and MSW):
  1. `EMPLOYER_NOT_APPROVED` (403) — company must be APPROVED.
  2. `WORKER_PROTECTION_VIOLATION` (422) — accommodation + healthInsurance +
     transportation must all be true; `meta.violations[]` lists failures.
  3. `JOB_QUOTA_EXCEEDED` (422) — Free plan: max 1 ACTIVE job; `meta.planLimit = 1`.
- **Core-rule settings** (WORKER_PROTECTION group) require SUPER_ADMIN — ADMIN
  callers get 403 `CORE_RULE_FORBIDDEN`.
- **Apply-gate ladder (S4, `POST /jobs/{id}/apply`)** — checked fail-fast in this
  LOCKED order, each with its own `code` + `meta` (documented in both spec and MSW):
  1. `JOB_NOT_ACTIVE` (422) — job not ACTIVE.
  2. `ALREADY_APPLIED` (409) — candidate already applied.
  3. `PROFILE_INCOMPLETE` (422) — `meta: { completionPct, threshold }`.
  4. `MANDATORY_DOCS_MISSING` (422) — `meta: { missing: DocumentType[] }`.
  5. `PASSPORT_INVALID` (422) — `meta: { reason: "expired" | "missing" }`.
- **Match snapshot** — `matchScore` + `MatchBreakdown` are computed ONCE at apply
  and frozen; never recomputed on later reads or status changes.
- **Application state machine** — employers move FORWARD only
  (PENDING → SHORTLISTED → SELECTED|REJECTED); illegal moves → 422
  `ILLEGAL_TRANSITION` (`meta: { from, to, allowed[] }`). Admins may move anywhere
  via `PATCH /admin/applications/{id}/status` but MUST supply `overrideReason` (else
  422 `OVERRIDE_REASON_REQUIRED`). There is NO `WITHDRAWN` state at MVP.
- **Once-per-application "Selected" WhatsApp** — guarded by `selectedNotifiedAt`;
  set on the FIRST entry to SELECTED. Re-entry sends email + in-app only.
- **`overrideReason` is admin-context-only** — never serialized to candidate or
  employer contexts, and excluded from the candidate-facing status timeline.
- **Stubs (later sprints):** Paths marked `[S5]`/`[S6]`/etc. return
  `501 NOT_IMPLEMENTED`. They exist so the full API surface is navigable.

## Validating the spec manually

```bash
pnpm --filter @skillindiaconnect/contract validate
# or, from this directory:
npx @redocly/cli lint openapi.yaml
```
