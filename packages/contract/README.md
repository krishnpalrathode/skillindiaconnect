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
| 0.6.0   | S6-0   | Admin console (both halves): audit log query + CSV export (`GET /admin/logs`, `/admin/logs/export`), admin dashboard (`GET /admin/dashboard`), the RBAC matrix (`GET`/`PATCH /admin/roles/matrix` — 423 `PERMISSION_CELL_LOCKED`), employer certificate access (`GET /admin/employers/{id}/certificate/url`), admin candidates + the purge (`GET /admin/candidates`, suspend/reactivate, `GET .../documents/{type}/url`, `POST .../purge`), admin jobs (`GET`/`POST /admin/jobs`, `/review`, `/pause`, `/archive`, `PATCH /flags`), internal application notes + the manual WhatsApp resend. New schemas: `AuditLogEntry`, `AdminDashboard`, `RbacMatrix`/`RbacCell`, `PermissionKey`, `AdminCandidateCard`, `AdminJobRow`, `NoteEntry`, `OffsetMeta`, `JobCreateRequest` (extracted from `POST /jobs`, now shared with on-behalf posting). **Enum gaps closed:** `UserRole` gained `MODERATOR`/`SUPPORT` and `JobStatus` gained `PENDING_REVIEW` — both existed in Prisma + the S2 seed but were unaddressable in the contract. |
| 0.7.0   | S6b-B1 | Candidate detail for the admin review panel (`GET /admin/candidates/{id}` → `AdminCandidateDetail`: card + experiences + skills + `applicationCount`). Suspend/reactivate guards made explicit: suspend is ACTIVE-only (409 `CANDIDATE_NOT_ACTIVE` / `CANDIDATE_PURGED` — suspending a PENDING_DELETION user must never silently cancel a DPDP erasure), reactivate is SUSPENDED-only (409 `CANDIDATE_NOT_SUSPENDED`). |
| 0.5.0   | S5-0   | Billing: plans (`GET /billing/plans`), subscription status (`GET /billing/subscription` — FREE is a well-formed state, never 404), invoices (`GET /billing/invoices`, sequential `SIC-YYYY-NNNNN`), checkout (`POST /billing/checkout` — `{ planCode }` only, server-side gateway routing, `Idempotency-Key`), order polling (`GET /billing/orders/{id}` — webhook-only activation), payment webhooks (`POST /webhooks/razorpay|stripe` — spec-only, NOT mocked), the Pro document gate (`GET /employers/candidates/{id}/documents/{type}/url` — `PLAN_UPGRADE_REQUIRED`, audited issuance, S3 404-indistinguishability inherited). Money = integer subunits everywhere. Publish quota is now plan-driven (`Plan.maxActiveJobs`). |

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
- **S5 billing — locked semantics:**
  - **Server-side gateway routing:** the checkout REQUEST carries `{ planCode }`
    and nothing else — no gateway field exists on it. The RESPONSE's `gateway` +
    the single matching `razorpay`/`stripe` block (never both) tell the FE what
    to launch. LOCAL companies → Razorpay domestic (INR + GST); FOREIGN →
    Razorpay International primary, Stripe only when `payments.stripe_enabled`
    is on. A client cannot force a gateway.
  - **Money = integer subunits** (paise/cents): `amountSubunits`, `gstSubunits`,
    `totalSubunits` + `currency` in every schema. A float money field anywhere
    is a contract defect.
  - **Activation is webhook-only:** the gateway success callback changes
    nothing; the FE polls `GET /billing/orders/{id}` until the webhook flips it
    to PAID (or FAILED / a timeout UX). Checkout errors, in ladder order:
    `EMPLOYER_NOT_APPROVED` (403), `PLAN_NOT_PURCHASABLE` (422, FREE included),
    `SUBSCRIPTION_ALREADY_ACTIVE` (409 — same-plan renewal EXTENDS the term and
    opens 7 days before expiry), `GATEWAY_UNAVAILABLE` (503).
  - **Grace (Answer 07):** 7-day GRACE after expiry; then EXPIRED pauses all
    ACTIVE jobs except the most recently published one. Publish quota is
    plan-driven (`Plan.maxActiveJobs`; Free 1, Pro unlimited).
  - **The Pro document gate** (`GET /employers/candidates/{id}/documents/{type}/url`):
    Free → 403 `PLAN_UPGRADE_REQUIRED`; every issuance audited; inherits S3's
    404 indistinguishability (hidden candidate ≡ nonexistent ≡ absent document)
    and never bypasses `profileVisible`.
- **S5 webhooks are NOT mocked (deliberate):** `POST /webhooks/razorpay` and
  `POST /webhooks/stripe` are server-to-server — the signature IS the auth
  (verify-before-parse on the raw body, `(provider, eventId)` dedupe, 200-fast
  + BullMQ enqueue, out-of-order reconciliation). The browser never calls them,
  so they are excluded from `handlers.ts`. Instead the mocks simulate the
  webhook's EFFECT: a mock order flips CREATED→PAID only after
  `ORDER_FLIP_POLL_THRESHOLD` (3) polls of `GET /billing/orders/{id}` — never
  instantly — forcing the FE to build the real "confirming your payment…"
  polling state (the S1 lesson applied to TIMING divergence). An
  `Idempotency-Key` starting with `fail-` flips the order to FAILED instead
  (the failure UX hook); `gwdown-` makes checkout return 503
  `GATEWAY_UNAVAILABLE`. On the simulated PAID: the mock subscription becomes
  ACTIVE, the next sequential invoice appears, and the S2-0 publish mock's
  quota lifts through the same plan seam. Fixture states: FREE (approved
  employers by default, incl. the LOCAL `employer-local@example.com` for the
  GST split), PRO ACTIVE (`employer-pro@example.com` — the document-gate signed
  URL), PRO GRACE (`employer-grace@example.com`).
- **S6 admin console — locked semantics:**
  - **EN-only.** i18n keys still exist so admin screens can be translated later,
    but there are no HI/AR fixtures and **no RTL obligations** on admin screens.
    User-facing (candidate/employer) i18n is untouched.
  - **RBAC is DATA, not role checks.** Every admin endpoint declares a
    `PermissionKey`; denial is 403 `FORBIDDEN` with `meta.requiredPermission`. A
    role holds a permission iff its `role_permissions` cell is enabled — so
    "SUPER_ADMIN-effective" means "seeded ON for SUPER_ADMIN, locked OFF for
    everyone else", never a hardcoded role branch.
  - **The 5 permission keys S6 ADDS** (`logs.export`, `roles.view`,
    `roles.manage`, `candidates.view_documents`, `jobs.moderate`) must be seeded
    into `permission.constants.ts` + `prisma/seed.ts` by **S6a-B2** — the seed
    hard-throws on an unknown matrix key. Deliberately NOT forked into
    near-duplicates: the purge reuses `candidates.delete` (already
    SUPER_ADMIN-effective), suspend/reactivate reuse `candidates.edit`, and
    on-behalf posting reuses `jobs.post_admin`.
  - **Locked matrix cells are immutable:** PATCH a locked cell → **423
    `PERMISSION_CELL_LOCKED`**, and NO write occurs. The whole SUPER_ADMIN column
    plus the seeded locked set are locked. The server enforces it because a
    disabled checkbox is not a security control. A successful write invalidates
    the affected role's permission cache (mechanism, not a client concern).
  - **The purge is immediate and IRREVERSIBLE:** `POST
    /admin/candidates/{id}/purge` requires `{ reason, confirm: true }` — missing
    either → 422 `PURGE_NOT_CONFIRMED`, because a mis-click must never anonymize
    a human being. It anonymizes in place (name → "Deleted user", contacts
    nulled, documents gone) and TOMBSTONES rather than row-deletes, so financial
    records and audit rows keep referential integrity and applications fall onto
    the S4 null-candidate path. It is the ADMIN trigger for the **same worker**
    as the candidate's own 30-day self-deletion — the difference is the trigger
    and the timing (no grace period), not the effect.
  - **Admin document access (both kinds) is audited per issuance:** employer
    certificates and candidate documents each mint a short-expiry signed GET and
    write a `document.viewed` row carrying the document TYPE — never the object
    key, never the signed URL. This is the DPDP who-saw-whose-passport trail.
    404 covers nonexistent / purged / never-uploaded, indistinguishably; unlike
    the employer gate, admins are NOT subject to `profileVisible`.
  - **Featured / Urgent are ADMIN-SET ONLY** (`PATCH /admin/jobs/{id}/flags`) —
    an employer can never set them on their own job, which is what keeps them
    meaningful. They drive the S2-F1 badges and the S2-B6 `?badge=` filters.
  - **On-behalf posting does not bypass the gates:** `POST /admin/jobs` runs the
    S2-B5 publish ladder against the TARGET employer unchanged
    (`EMPLOYER_NOT_APPROVED` → `WORKER_PROTECTION_VIOLATION` → `JOB_QUOTA_EXCEEDED`).
  - **Internal notes are internal.** `NoteEntry` never appears on `Application`,
    `ApplicationDetail`, `ApplicationCard`, `ApplicantCard`, or the
    candidate-facing timeline. Adding it to a non-admin surface is a contract
    violation, not a feature.
  - **The manual WhatsApp resend is the `bypassGuard` seam:** SELECTED-only (else
    422 `APPLICATION_NOT_SELECTED`), capped at 3 per application per 24 h (else
    429), and always audited with the acting admin — the bypass is never
    anonymous.
  - **The audit log:** keyset-paginated over the BigInt PK (rendered as a
    string), newest first; `meta` is already redaction-safe at write time (S2-B2),
    so no raw PII can reach the screen. Reading the log is itself audited, and so
    is exporting it. The CSV export is a SEPARATE, higher grant (`logs.export`)
    and is bounded — ≤10,000 rows and ≤90 days, else 422 `EXPORT_TOO_LARGE`.
- **S6 mocks are RBAC-ACCURATE (the point of them):** `handlers.ts` enforces each
  endpoint's `PermissionKey` against a faithful copy of the API's seeded matrix,
  with a fixture user per admin role (`superadmin@`, `admin@`, `moderator@`,
  `support@example.com`). So the console is built against REAL denials — a
  MODERATOR genuinely gets 403 on `logs.export` / `roles.manage`, and an ADMIN
  genuinely gets 403 on the purge. A permissive mock would ship an admin UI full
  of buttons the user cannot actually press.
- **No `NOT_IMPLEMENTED` stubs remain.** As of S6 every contract endpoint is live
  in `handlers.ts`. The only deliberate omissions are `/webhooks/razorpay|stripe`
  (server-to-server; the mocks simulate their EFFECT instead).

## Validating the spec manually

```bash
pnpm --filter @skillindiaconnect/contract validate
# or, from this directory:
npx @redocly/cli lint openapi.yaml
```
