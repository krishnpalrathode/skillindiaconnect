# Testing Architecture — Skill India Connect

> **Status (2026-07-27)**
> - **Phase 0 — IMPLEMENTED** (this change): the Playwright UI-regression suite moved to
>   `tests/ui/`, CI fixed to run it in **MSW mode**, and a post-deploy smoke added.
> - **Contract-conformance — SCOPED as its own small unit** (§Contract Conformance Unit),
>   to be built next so the mock layer is trustworthy *without* the full real-stack harness.
> - **Phases 1–3 (real-stack E2E harness + journeys) — DEFERRED to post client handoff.**
>   When resumed, we start with **only two journeys** — `checkout → webhook → activation`
>   and **one worker-protection journey** — not the full 6–10.
>
> This document is the agreed destination. It is reviewed and approved before code changes;
> Phase 0 was approved and is done.

---

## 0. Current state (the accurate picture)

The **entire Playwright suite is UI-regression against MSW** — 20 of 21 specs authenticate with
`any-password` (MSW mock auth) and depend on mock data, mock R2 URLs, mock OTP, and a simulated
payment poll-flip. Only `smoke.spec.ts` is backend-agnostic. There was **no automated real-stack
browser coverage**; the one "real-stack pass" performed to date (the S6 happy-path walk) was
manual.

What already exists and is strong, and remains the backbone:

- **Unit / component** — `apps/api` Jest (~1032 tests) + `apps/web` Vitest (~355 tests).
- **API integration** — `apps/api` Jest + **Testcontainers** (real Postgres/Redis; external sends
  mocked). This is the authoritative backend-behaviour layer.
- **Contract** — `packages/contract/openapi.yaml` is the source of truth; `shared-types` is
  generated from it and the MSW handlers mirror it.

The gap is exclusively **browser-through-real-stack E2E**, which Phases 1–3 fill post-handoff.

---

## 1. The layer model (the pyramid for this repo)

| Layer | Tooling | Backend | Runs |
| --- | --- | --- | --- |
| Unit / component | Jest (api) · Vitest (web) + MSW | none | every PR |
| **API integration** (Cat. B) | Jest + Testcontainers | real PG/Redis, mocked externals | every PR |
| **UI regression** (Cat. A) | **Playwright + MSW** (`tests/ui/`) | mock (MSW) | every PR |
| **True E2E** (Cat. C) | Playwright + real stack + sandbox externals (`tests/e2e/`, *deferred*) | real API+DB+MinIO+Razorpay test mode+Mailpit | pre-merge subset · nightly · pre-prod |
| Contract conformance | Spectral + schema-validate | — (nightly variant hits real API) | every PR (+ nightly) |
| Post-deploy smoke | Playwright (`tests/smoke/`) | the live deployment | after deploy / daily |

**Guiding principle:** exercise end-to-end the things we own and can drive deterministically (our
API, DB, R2 via MinIO, payment *logic* via Razorpay test mode); mock the things we can't drive
deterministically (real email delivery, WhatsApp, Google OAuth). The `EmailChannel` /
`WhatsappChannel` / `PaymentGateway` ports already make this swappable per environment.

---

## 2. Project structure

```
tests/
  ui/                      # Category A — Playwright + MSW  (the 21 specs; IMPLEMENTED)
    fixtures/constrained.ts
    tsconfig.json
    *.spec.ts
  e2e/                     # Category C — Playwright + real stack  (DEFERRED, post-handoff)
  smoke/                   # post-deploy read-only smoke  (IMPLEMENTED)
    post-deploy.smoke.spec.ts

playwright.config.ts       # the UI-regression (MSW) config — testDir tests/ui, webServer forces MSW
playwright.smoke.config.ts # post-deploy smoke — no webServer, targets SMOKE_BASE_URL
# playwright.e2e.config.ts # real-stack config — added when Phase 2 lands

apps/api/  Jest + Testcontainers   # Category B (backend integration)
apps/web/  Vitest + MSW            # component/unit
packages/contract/                # openapi.yaml = source of truth (+ conformance unit)
```

Note: Phase 0 keeps a **single** `playwright.config.ts` as the UI/MSW config (minimal churn,
`pnpm test:e2e`/`test:ui` keep working). It splits into `playwright.ui.config.ts` +
`playwright.e2e.config.ts` when the real-stack layer lands. Backend integration stays in
Jest/supertest — a browser adds nothing to "does the API return the right shape."

---

## 3. Spec classification (why each belongs where)

Category: **A** UI-regression (MSW) · **B** integration (real API) · **C** true E2E.
"Counterpart" = a *separate, additional* real-stack test that should coexist (never a rewrite).

| Spec | Category | Why | Real-stack counterpart (deferred) |
| --- | --- | --- | --- |
| `smoke` | C (trivial) | No API dependency; it *is* the post-deploy smoke's ancestor. | it is the counterpart |
| `auth` | A | Login/signup/OTP/forgot *form behaviour*, enumeration-safety. | one C happy login (real JWT) |
| `onboarding` | A | Stepper, upload state machine, completion ring — FE state logic. | one C: onboarding→completion + real R2 |
| `job-search` | A (+B) | SSR + filter UI; ranking is real-Postgres FTS. | B: search relevance against real API |
| `employer-onboarding` | A | Company onboarding form/validation. | one C happy path |
| `employer-profile` | A | Profile edit UI. | — |
| `employer-candidates` | A | Browse UI; privacy omission is server-enforced. | covered by B (API viewer-aware tests) |
| `candidate-visibility` | A | Visibility UI; privacy is a server invariant. | covered by B (API layer) |
| `applicants` | A | Employer viewing applicants UI. | — |
| `apply` | A (+C) | Apply UI + gate messaging; gate+match snapshot is server-critical. | C: real apply, real gate, real match |
| `my-applications` | A | Applications list UI. | — |
| `dashboard-notifications` | A | Feed/filters UI. | — |
| `resume-export` | A (+C) | Preview/export UI; byte-level omission covered at API. | C: real Puppeteer render + download |
| `resume-settings-delivery` | A | Settings + send UI; delivery mocked everywhere. | partial C (enqueue at API layer) |
| `admin-shell` | A (+B) | Role→nav/403; RBAC is server-enforced. | covered by B (API RBAC integration) |
| `admin-candidates` | A (+C) | Admin mgmt + **purge**. | **C: real purge → tombstone** |
| `admin-employers-settings` | A | Approval + settings + RBAC denials. | C: real approval round-trip |
| `admin-jobs-applications` | A (+B) | Jobs moderation + gate-failure explainer. | covered by B (publish-guard integration) |
| `admin-logs-roles` | A (+B) | Audit explorer + RBAC matrix + "grant takes effect". | covered by B (RBAC cache-invalidation integration) |
| `checkout` | A (+**C crown jewel**) | Payment UI + poll-to-confirm. | **C: real order→webhook→activation→invoice (Razorpay test mode)** |
| `subscription-management` | A (+C) | Subscription/invoice/plan-gate UI across plan states. | C: real activation→invoice→plan-gated doc |

**The pattern:** almost every spec is a legitimate UI-regression test **and** several guard a
server invariant deserving an *independent* real-stack test. They cover **different risks** (§6).
Coexist; do not rewrite.

---

## 4. The 7 previously-failing MSW specs — individual verdicts

Decision rule: MSW answers *"given a correct API response, does the UI behave?"*; a real-stack
test answers *"does the real system produce that response / complete that journey?"* Different
risks → **coexist**, never auto-replace.

| Spec | Verdict | Different risk each version covers |
| --- | --- | --- |
| `admin-shell` | Keep MSW; no new C (covered by B) | MSW: nav renders per permission set. B: permissions actually enforced. |
| `admin-candidates` | Keep MSW **+ add C** | MSW: type-to-confirm gating UX. C: real purge anonymises + destroys R2. |
| `admin-employers-settings` | Keep MSW **+ add C (approval)** | MSW: per-role button visibility + friction. C: approval flips status + fires notification. |
| `admin-jobs-applications` | Keep MSW; no new C (covered by B) | MSW: explainer names the right rules. B: the guard enforces them. |
| `admin-logs-roles` | Keep MSW; no new C (covered by B) | MSW: matrix editor UX. B: grant persists + cache invalidates. |
| `checkout` | Keep MSW **+ add C (crown jewel)** | MSW: polling survives latency, no false success. C: real money-path (Razorpay test mode). |
| `subscription-management` | Keep MSW **+ add C (one journey)** | MSW: all plan states render. C: real activation → real sequential invoice → real plan-gate. |

All 7 **stay as MSW UI-regression** (their value is intact); 4 gain an *additional* real-stack
journey when Phase 2 lands. Per the approved amendment, Phase 2 begins with just **`checkout`**
(the crown jewel) **+ one worker-protection journey** (e.g. the apply/publish gate), expanding
later.

---

## 5. CI pipeline

| Stage | Suites | Infra | Gating |
| --- | --- | --- | --- |
| **Every PR** | lint · typecheck · unit (Jest+Vitest) · **API integration** (Testcontainers) · **UI regression** (Playwright MSW, 4 shards) · **contract conformance** · build | ephemeral PG/Redis (Jest); no external network | **Required**, fast, deterministic |
| **Pre-merge** | above **+ E2E-critical subset** (deferred) | ephemeral full stack | Required, lean |
| **Nightly** | full E2E (deferred) · performance · a11y · chaos · backup-restore · **real-API-vs-spec conformance** | full ephemeral stack + sandbox externals | Non-blocking; alerts |
| **Pre-prod** | full E2E + smoke against the deployed **staging** URL (deferred) | staging | Gate to prod |
| **Post-deploy** | read-only smoke (`tests/smoke/`) against the live URL | production/Vercel | Alert-only |

Discipline: the **MSW suite runs every PR but is not a backend release gate** — it can be green
while prod breaks (drift). The **E2E suite is the release gate**, kept small to stay fast and
non-flaky. Contract conformance is what makes the MSW layer *trustworthy* (below).

---

## 6. Contract Conformance Unit (scoped — build next; no real-stack harness needed)

**Why it's the linchpin:** this repo has a documented recurring bug class — *the real API deviates
from `openapi.yaml` while mock + web + spec agree*. That is exactly why MSW tests can pass while
production fails. Binding the mock to the contract removes the risk without standing up the full
real stack.

Three pieces, deliverable independently and small:

1. **Spectral lint of `openapi.yaml`** — a ruleset (naming, response envelopes per
   `api-conventions.md`, required error `code`s, examples present). Runs on every PR. Fast, no
   infra.
2. **MSW-response schema validation** — assert that every MSW handler's response validates against
   the corresponding `openapi.yaml` schema (drive the existing generated types / an AJV check over
   the handlers). This proves the *mock* cannot drift from the *contract*. Runs on every PR.
3. **Nightly real-API-vs-spec conformance** — a Dredd/Schemathesis-style check that the *real*
   API's responses validate against the spec, run against the ephemeral API + Testcontainers DB
   (which already exist for Jest). This proves the *real API* cannot drift from the *contract*.
   Nightly (needs the API up), not per-PR.

Together, (1)+(2) bind mock→contract on every PR; (3) binds real-API→contract nightly. With all
three, "MSW is green" becomes a trustworthy signal, because mock and real API are both pinned to
the same source of truth.

---

## 7. Data seeding for integration/E2E (when Phase 1 lands)

Principle: **deterministic, isolated, self-owned — no large shared mutable fixture.**

- **Ephemeral database per run** (already the Jest/Testcontainers pattern; mirror it for the E2E
  job's Postgres). A fresh DB per run eliminates cross-run state.
- **Two tiers:** (a) *reference data* (plans, job categories, RBAC matrix) via a small **idempotent
  seed** — read-only, shared, safe; (b) *test-owned data* — **each test creates its own via the
  real API** with **unique identifiers** (UUID/email-prefix), so parallel tests never collide.
- **Isolation by unique namespace** (preferred for HTTP-driven tests) over truncation-between-tests
  (serialises the suite) or transactional rollback (impractical across HTTP). Snapshot-and-restore
  when a test must mutate reference data.
- **Never** a shared long-lived database — that is the source of flaky "someone else's data leaked"
  failures.

---

## 8. Authentication in real-stack tests (when Phase 1 lands)

- **Candidates:** create through the **real signup API**, then log in via the **real login
  endpoint** for a real JWT — exercises the real path, no backdoor.
- **Privileged roles** (admin/moderator/super-admin; no self-signup): seed via a **non-prod-guarded
  seed script** (or a test-only bootstrap endpoint that refuses to run when `NODE_ENV=production`),
  then authenticate through the **real login endpoint**. Credentials live only in the test env's
  secret store.
- **Reuse via Playwright `storageState`:** a global setup logs in once per role, saves the auth
  state, and every test loads it — fast, and it mirrors the real token lifecycle. This replaces the
  MSW `any-password` shortcut cleanly.
- **Never** mock tokens / `any-password` in the real-stack suite. **Google OAuth** is not reliably
  automatable headless → excluded from E2E; cover the callback at unit/integration level.

---

## 9. Payments, email, storage, third parties

| Integration | UI-regression (A) | Integration/E2E (B/C) | Never |
| --- | --- | --- | --- |
| Payments (Razorpay) | MSW simulated CREATED→PAID flip | **Razorpay TEST MODE**: real order + signed test webhook → real activation | live Razorpay in tests |
| Email (Titan/SMTP) | MSW records the send | **Mailpit/MailHog** (or Nodemailer stream) via `EmailChannel` + `EMAIL_PROVIDER` | real Titan in CI (that's the manual go-live smoke) |
| Object storage (R2) | MSW `sig=mock` URLs | **MinIO** (already in docker-compose): real presign + put/get | live Cloudflare R2 in CI |
| WhatsApp (Meta) | `MockWhatsappChannel` | stays **mock** until Meta templates approved | live Meta in CI |
| OAuth (Google) | mock | excluded from E2E; unit-test the callback | real Google headless |

The ports (`EmailChannel`/`WhatsappChannel`/`PaymentGateway`) are already the seams that make this
per-environment wiring trivial — the architecture is right; it needs a `mailpit`/`minio` binding
for the E2E env.

---

## 10. Migration plan

**Phase 0 — Unblock + relabel — ✅ DONE (this change).**
Moved the 21 specs to `tests/ui/`; `playwright.config.ts` points there and forces MSW via
`webServer.env` (no more `.env.local` flip); the CI `e2e` job runs the MSW suite (dev server + MSW,
no real API/DB); added `tests/smoke/` + `playwright.smoke.config.ts` + the `post-deploy-smoke`
workflow. **No spec content changed.**

**Contract Conformance Unit — NEXT (scoped in §6).** Independent of the real-stack harness.

**Phase 1 — Real-stack foundation — DEFERRED (post client handoff).**
Ephemeral full stack (API+web+PG+Redis+MinIO+Mailpit+Razorpay test mode); `storageState` auth
global-setup per role; idempotent reference seed + self-seeding helpers.

**Phase 2 — Crown-jewel journeys — DEFERRED (post handoff).**
Start with **`checkout → webhook → activation`** and **one worker-protection journey** only (not
6–10). These coexist with the MSW versions.

**Phase 3 — Maturity & scale — DEFERRED.**
Pre-prod gate against staging URL; flake budget + quarantine; fold in the existing
performance/a11y/chaos/backup-restore reports as scheduled gates; expand coverage.

---

## 11. Trade-offs & final recommendation

- *MSW UI layer* — fast/deterministic/infra-free, runs every PR; **but** can pass while prod
  breaks → *mitigated by the contract conformance unit*; never the backend release gate.
- *Real-stack E2E* — high fidelity; **but** slow/flaky/infra-heavy → keep it **small** (only
  journeys where the integration itself is the risk), run heavy variants nightly/pre-prod.
- *Two suites to maintain* — **but** they cover genuinely different risks; conflating them created
  the original mess. Separate by config + directory + data strategy.

**Final recommendation:** a four-layer model — unit/component, API integration (Jest+Testcontainers),
**UI regression (Playwright+MSW)** = the existing 21 specs kept and honoured, and a **small
true-E2E layer** (deferred, starting with checkout + one worker-protection journey) — bound by
**contract-conformance** that makes MSW trustworthy. Do **not** rewrite the MSW specs; add
independent real-stack journeys for the invariants that carry money/safety risk. Exercise what we
own (API, DB, R2-via-MinIO, Razorpay test mode, email-via-Mailpit); mock what we can't drive
(real email/WhatsApp/OAuth).
