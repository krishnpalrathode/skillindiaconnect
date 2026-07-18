# S8-H2 — Security Audit Report

OWASP Top-10 audit of the built system, with three priority focuses: the
authorization matrix, the privacy-omission guarantees, and the
injection/webhook surfaces. **No product features were added; every change is a
targeted security patch referenced to a finding.**

- **Target:** the compiled production build (`apps/api/dist`), run as its own
  process against real Postgres + Redis + MinIO.
- **External providers:** none contacted. WhatsApp/email resolve to the mock
  channels; Razorpay webhooks are **inbound only**, signed locally with
  `RAZORPAY_WEBHOOK_SECRET`; R2 is local MinIO. No gateway API key is used by
  any probe.
- **Evidence:** every claim below is produced by a re-runnable script in
  [`security/probes/`](../security/probes); raw results land in
  `security/probes/out/*.json`.

---

## 1. Findings

| ID | Severity | OWASP | Title | Status |
|---|---|---|---|---|
| **SEC-001** | **High** | A01 Broken Access Control | Cross-tenant job **enumeration oracle** — ownership failure returned 403 while a missing job returned 404 | **Fixed** |
| **SEC-002** | **Medium** | A03 Injection / A05 Misconfiguration | A NUL byte in the search query crashed the request with an unhandled 500 | **Fixed** |
| **SEC-003** | **Medium** | A05 Security Misconfiguration | Oversized request bodies answered `500 INTERNAL_ERROR` instead of `413`, logging a client error as a server fault | **Fixed** |
| **SEC-004** | **Medium** | A03 Injection (template) | Resume PDF template interpolated the photo data-URI into `src=""` **unescaped** — attribute-injection landmine | **Fixed** |
| **SEC-005** | **Medium** | A05 Security Misconfiguration | No security response headers; `X-Powered-By: Express` advertised | **Fixed** |
| **SEC-006** | **Medium** | A06 Vulnerable Components | `next@14.2.35` carries 15 advisories (SSRF, middleware bypass, DoS, XSS) with **no patch in the 14.x line** | **Open — reported, see §6** |
| **SEC-007** | **Low** | A05 Security Misconfiguration | Rate limiting is in-memory, so limits are per-replica rather than global (pre-existing, previously documented) | **Open — reported** |

**No Critical findings.** No authentication bypass, no privilege escalation, no
cross-tenant data exposure, no successful injection, no secret leakage.

### Verification totals (after fixes)

| Probe | Checks | Result |
|---|---|---|
| `security:authz` — every endpoint × every role | 753 | **753 pass** |
| `security:idor` — horizontal privilege, all resource types | 49 | **49 pass** |
| `security:privacy` — omission + invisibility + gate ordering | 32 | **32 pass** |
| `security:injection` — FTS SQL, XSS, oversize, PDF template | 76 | **76 pass** |
| `security:webhook` — signature tampering + raw-body scoping | 23 | **23 pass** |
| `security:authconfig` — auth, secrets, redaction, CORS, headers, SSRF | 92 | **92 pass** |
| **Total** | **1,025** | **1,025 pass** |

---

## 2. SEC-001 — Cross-tenant job enumeration oracle (High)

**OWASP:** A01:2021 Broken Access Control · **Status: Fixed**

### The defect

`JobsService.assertOwnership` threw `403 JOB_NOT_OWNED` when a job belonged to
another company, while a job that did not exist threw `404 JOB_NOT_FOUND`. The
two responses differed, and that difference *is* the vulnerability.

### Reproduction

```
# As employer A, against employer B's DRAFT job:
GET /api/v1/employers/me/jobs/{B_job_id}      → 403 JOB_NOT_OWNED   ← "this id is real"
GET /api/v1/employers/me/jobs/{random_uuid}   → 404 JOB_NOT_FOUND   ← "this id is not"
```

### Impact

Any authenticated employer could partition uuids into "exists on this platform"
and "does not", across **five endpoints** (`GET`, `PATCH`, `/publish`,
`/archive`, `/duplicate`). Because the probe worked on DRAFT jobs, it leaked the
existence — and through the lifecycle endpoints the *state* — of competitors'
**unpublished** postings.

No data was returned and no write landed (both verified). The leak is existence
itself, which is precisely what the 404-not-403 convention exists to prevent:
403 admits a resource is there; 404 says nothing.

### Remediation

`apps/api/src/jobs/jobs.service.ts` — ownership failure now throws the identical
`404 JOB_NOT_FOUND`. 403 is reserved for RBAC denials, where the resource's
existence is not secret.

**Three pre-existing tests asserted the vulnerable behaviour** (`throws 403 when
employer tries to update another company's job`, and the publish/duplicate
equivalents) — they encoded the bug. They now assert 404, and a new
`SEC-001 — cross-tenant existence hiding` block proves foreign-vs-nonexistent
responses are identical in **both status and machine code** across all four
entry points.

---

## 3. SEC-002/003 — Error hygiene (Medium ×2)

**OWASP:** A03 Injection / A05 Security Misconfiguration · **Status: Fixed**

Neither leaked information — the error envelope was correctly generic in both
cases (`{"status":500,"code":"INTERNAL_ERROR","detail":"Internal Server Error"}`
with no stack, SQL, or path). Both are availability/hygiene defects.

**SEC-002 — NUL byte in the search query.** `GET /api/v1/jobs?q=welder%00DROP`
returned 500. Root cause: Postgres `text` cannot represent U+0000, so the driver
raised `22021 invalid byte sequence for encoding "UTF8": 0x00`, which is not an
`HttpException` and fell through to the generic 500.

*This is not an injection* — the value remained a bound parameter and nothing was
executed. But an **unauthenticated** one-byte request that reliably produces a
server error and an ERROR-level log line is both a hygiene defect and cheap
log-flooding leverage. Fixed by stripping NUL from `q`/`category` at the DTO
(a NUL is never a meaningful search term) and adding length caps.

**SEC-003 — oversized body reported as a server fault.** A 2MB POST answered
`500 INTERNAL_ERROR` rather than `413`. Root cause: `body-parser` throws
`PayloadTooLargeError`, which carries `status: 413` but is not an
`HttpException`, so `HttpProblemFilter` treated it as an unhandled crash — and
logged it at ERROR with a stack, letting an unauthenticated caller flood the
logs at will.

Fixed by teaching the filter to honour the status on express-layer errors. Only
the **status** is taken from the error; the message is deliberately not used as
`detail`, so the client still gets the generic per-status envelope. 4xx now logs
at `warn` without a stack, so genuine incidents stay visible.

---

## 4. SEC-004 — PDF template attribute injection (Medium)

**OWASP:** A03:2021 Injection · **Status: Fixed**

The resume template escapes every text interpolation through `esc()`, and that
holds: hostile names, father-names, locations and skills all render as inert
entities (verified directly against the template, with a control assertion that
the escaped form is actually present so the test cannot pass vacuously).

**One value was not escaped:** the photo data-URI, which lands in an *attribute*
rather than in text:

```ts
`<img class="photo" src="${view.photoDataUri}" alt="" />`   // before
```

A URI containing a double-quote closes `src=""` and the remainder becomes
attributes. `data:image/png" onload="alert(1)` yields a live `onload` handler
**executing inside the Chromium render context**.

**Not reachable today.** `photoDataUri` is built server-side from an R2 fetch,
and **no endpoint ships that lets a candidate set their photo** — so the
content-type is not attacker-controlled. This is a landmine, not a live hole,
and it is reported as such.

It is worth fixing now because the upstream guard is
`contentType.startsWith('image/')`, which would happily pass
`image/png" onload="…` the moment a photo-upload route lands. Fixed with two
independent guards: a shape validation that the value really is a
`data:image/*;base64,…` URI, plus `esc()` so a quote can never terminate the
attribute. Three regression tests cover text escaping, attribute containment,
and that a legitimate photo still renders.

---

## 5. SEC-005 — Missing security headers (Medium)

**OWASP:** A05:2021 Security Misconfiguration · **Status: Fixed**

The API returned **none** of `X-Content-Type-Options`, `X-Frame-Options`,
`Strict-Transport-Security`, or `Referrer-Policy`, and advertised
`X-Powered-By: Express`.

This is a JSON API, so the browser-facing risk is narrower than for an HTML app,
but two matter directly:

- **`nosniff`** stops a browser MIME-sniffing a JSON response containing
  attacker-supplied text (a cover letter, a company description) into HTML and
  executing it. Given the app stores user text and returns it to other users,
  this is the one that counts.
- **HSTS** keeps the httpOnly refresh cookie off plaintext HTTP.

Fixed with `helmet` in `main.api.ts`, plus disabling `x-powered-by` at the
adapter. Two of helmet's defaults are deliberately **off**:

- `contentSecurityPolicy` — helmet's CSP is written for HTML documents and would
  add bytes to every JSON response while protecting nothing. The web app owns
  its own CSP; that is where it belongs.
- `crossOriginResourcePolicy` — it would contradict the deliberately-scoped CORS
  configured immediately below it. CORS is the control here.

---

## 6. SEC-006 — Vulnerable dependencies (Medium, Open)

**OWASP:** A06:2021 Vulnerable and Outdated Components · **Status: Open — cannot be patched within this unit**

`pnpm audit` reports 52 advisories. Counting them is not triage, so they are
split by whether the code is reachable in a shipped runtime:

| Class | Count | Assessment |
|---|---|---|
| **Dev/build-only** (`testcontainers`, `@nestjs/cli`, `@redocly`, jest, eslint, playwright) | 24 | **Not shipped.** `undici`(9), `minimatch`(3), `tmp`, `webpack`, `picomatch`, `js-yaml`, `glob`, `ajv`, `form-data`. No production exposure. |
| **`next@14.2.35`** (apps/web) | 15 | **The real finding** — see below. |
| **Transitive, not exercised** | 13 | `multer` (5 DoS advisories) ships via `@nestjs/platform-express` but **the app never uses multipart uploads** — files go direct to R2 via presigned PUT, so no multer route exists. `lodash` `_.template` code-injection requires calling `_.template` with attacker input; `@nestjs/config` does not. `file-type`, `qs`, `postcss` similarly unreached. Low practical risk; they should still ride the next framework bump. |

### The Next.js problem, stated honestly

`next@14.2.35` is **already the latest stable 14.x** — there is no patch release
to take. The advisories (SSRF, Middleware/Proxy bypass, several DoS, XSS, cache
poisoning) are fixed only in **15.x**, which is a major-version migration:
squarely a feature-sized change, and explicitly outside a unit whose fixes are
meant to be minimal, targeted security patches.

Partial mitigating context, from reading the app rather than the advisory titles:

- The **Middleware/Proxy bypass** advisory is scoped to the **Pages Router**.
  This app is **App Router only** (`apps/web/src/app`, no `pages/` directory).
- Several DoS advisories concern the self-hosted **Image Optimization** endpoint.
  `next/image` is used, so these are **not** excluded.

**Recommendation:** schedule the Next 15 migration as its own unit. Until then
the SSRF and image-optimizer DoS advisories are live exposure on the web tier
and should be tracked as accepted risk with an owner, not silently carried.

---

## 7. Priority 1 — The authorization matrix

**Method.** The endpoint list is **not** grepped. `security/probes/endpoint-inventory.ts`
boots the real Nest container and walks `DiscoveryService`, reading the same
metadata keys the guards read at request time (`isPublic`, `isOptionalAuth`,
`requiredPermissions`). If an endpoint exists, it is in the list.

**113 routed endpoints across 35 controllers**, classified:

| Class | Count | Meaning |
|---|---|---|
| PUBLIC | 14 | No auth. Each reviewed individually: 8 auth/OAuth routes, 2 public job feeds (optional-auth), job categories, 2 signature-verified webhooks, `/health`. |
| PERMISSION-GATED | 34 | `@RequirePermissions`. **Every `/admin/*` route is gated** — no admin surface is missing its guard. |
| AUTH-ONLY | 65 | Authenticated, ownership-checked in the service (`/candidates/me/*`, `/employers/me/*`). Correct by design; ownership proven separately by the IDOR sweep. |

The sweep drove **107 endpoints × 7 principals = 753 checks**, computing each
expectation from the guard metadata and the **live `role_permissions` table**
(so it audits the deployed matrix, not the seed file). Mutating verbs were
exercised too — a write endpoint with a missing guard is exactly the hole worth
finding.

**Result: 753/753 pass.** Full grid in [`authz-matrix.md`](./authz-matrix.md).

- **No unauthenticated access** to any non-public endpoint (401 on all).
- **No vertical escalation.** Every seeded denial holds: MODERATOR is refused
  `employers.suspend`, `candidates.delete`, `applications.change_status`, and
  `logs.export`; ADMIN is refused `roles.manage`; SUPPORT is refused everything
  it lacks. A CANDIDATE reaches no employer or admin action.
- **Existence hiding holds** on admin reads of nonexistent ids (404, not 500).

### Horizontal privilege (IDOR) — every resource type

As tenant A, requested tenant B's resource across **job (draft/active), job
lifecycle actions, applicants, application status, contact person, order,
candidate document URL, candidate application, work experience, skill**, plus
cross-role attempts. Each case asserts three things:

1. **No data** — the response is never 2xx.
2. **404, not 403** — no existence oracle.
3. **Indistinguishable** from a nonexistent id — *same status and same machine
   code*. This is the check that caught SEC-001, and it is stricter than "is it
   a 404", which SEC-001 would have passed on the ghost request alone.

Plus **write-through verification**: after every mutating IDOR attempt, the
victim's row is re-read from the database to confirm nothing changed. Tenant B's
job title/status, contact, application status, and candidate child rows all
survived intact.

**Result after SEC-001: 49/49 pass.**

---

## 8. Priority 2 — Privacy omission under adversarial probing

**Result: 32/32 pass.** No changes were required — the viewer-aware DTO layer
held everywhere it was attacked.

- **Omission is true omission.** For a candidate with `showPhone:false` /
  `showReligion:false`, the **key is absent** — not null — across the employer
  candidate view, the browse card, and the applicant card ("the third path").
  Both the key *and* the underlying value were searched in the raw bytes.
- **`dob` never leaves.** Absent from every employer-facing path; only derived
  `age` is exposed.
- **Internal notes are unreachable.** A planted `INTERNAL-NOTE-…-DO-NOT-LEAK`
  marker appears in no employer- or candidate-facing response.
- **Invisible candidates are indistinguishable** from nonexistent ones through
  every candidate-touching endpoint — identical status, identical machine code,
  **byte-identical bodies**, no list presence in browse, and no gross timing
  difference (medians compared over 9 repetitions per case).
- **The document gate's ordering holds.** A FREE employer probing an invisible,
  a real, and a nonexistent candidate gets the **identical** `403
  PLAN_UPGRADE_REQUIRED` — the plan check fires before the candidate is ever
  looked at, so nothing is learned. A PRO employer, past that gate, still gets
  the privacy 404 on an invisible candidate.
- **Timeline shaping holds.** `overrideReason` and `actorUserId` are absent from
  the candidate view, and the acting admin's uuid appears nowhere in the bytes
  under any key name.

### Two probe bugs worth recording

Both initially looked like findings; both were **my probe's fault**, and the
distinction matters because a security report that cries wolf is worse than none.

1. **`phone` in the applicant card.** The applicant list I queried contained a
   *different* candidate (default `showPhone:true`) — the private candidate had
   never applied. The probe now makes the private candidate apply and **scopes
   the assertion to that candidate's own object**, with an explicit
   "subject-present" check so it fails loudly rather than vacuously if the
   subject is missing.
2. **`actorRole` in the candidate timeline.** This is **deliberate and
   contractual** (frozen S4-0 `TimelineEntryDto`): a candidate may see that *an
   admin* moved their application; a coarse role is not an identity. The
   exclusions are `overrideReason` and `actorUserId`. Asserting its absence
   would have contradicted the contract.

A **vacuity control** is included: the ADMIN context is asserted to *contain* the
phone the employer context omits. Without it, every omission check above could
pass simply because the data was missing everywhere.

---

## 9. Priority 3 — Injection, webhooks, and the PDF path

### The FTS raw-SQL path — 53/53 pass

`q` is the only user input reaching `$queryRaw`. Hit with **25 payloads**: SQL
injection (`' OR '1'='1`, `UNION SELECT`, stacked `DROP TABLE jobs`, stacked
`DELETE`), time-based blind (`pg_sleep`), boolean blind, tsquery-breaking syntax
(`&|!():*`, unbalanced parens, `<->`), unicode (RTL override, Cyrillic
homoglyphs, emoji), template-literal (`${process.env.JWT_ACCESS_SECRET}`), path
traversal, XXE-shaped input, and oversized (10k / 100k).

- **No injection.** Parameterization holds — the `jobs` and `users` tables were
  counted before and after and are intact.
- **No time-based injection** — `pg_sleep` payloads returned in milliseconds.
- **No SQL/driver leakage** — no `syntax error`, `pg_`, `prisma`, or stack frame
  in any response body.
- One payload produced a 500 (**SEC-002**, fixed).

The whitelisted filter params (`market`, `category`, `sort`, `currency`,
`badge`) reject injection payloads at DTO validation.

### Stored XSS and oversize — 15/15 pass

Script payloads stored through cover letters return as **JSON-encoded text with
`application/json`**, never as executable HTML, on both the write and the
employer read-back. Oversize input is now cleanly rejected (SEC-003).

### The PDF template — 3/3 pass after SEC-004

Covered in §4.

### Webhook signature verification — 23/23 pass

Nine tampering cases, each also verified to produce **zero side effects**
(order still `CREATED`, no invoice, no payment row, no subscription):

no signature · empty signature · garbage signature · **wrong secret** · **body
modified after signing** · **valid signature lifted from a different event** ·
truncated signature (length-check probe) · Stripe-format signature on the
Razorpay route · **unsigned + unparseable body**.

That last case is the **verify-before-parse proof**: a body that is *both*
unsigned *and* invalid JSON returns `401`, not a JSON syntax error. If parsing
preceded verification, the response would have been a parse error.

A **control case** confirms a correctly-signed event *is* accepted and does
activate the order — without it, every "rejected" result could mean a broken
endpoint rather than working verification. Replay of a valid event is a 200
no-op with exactly one invoice (dedupe holds).

**Raw-body scoping** (the production-only regression) is proven from both sides:
webhook routes get raw bytes, while a normal route still parses JSON *and* runs
DTO validation.

---

## 10. Cross-cutting OWASP — 92/92 pass

**A07 Authentication.** Every forgery attempt is rejected with 401:
`alg:none`, a token signed with an attacker-chosen secret, an expired token, a
**refresh token presented as an access token**, a **payload-tampered role claim**
(edited to `SUPER_ADMIN`), garbage, and empty. The tampered-role token also
fails to reach an admin endpoint. The **post-logout blacklist holds** — with a
control proving the same token worked *before* logout. **Rate limiting throttles
and returns 429, never 5xx**, on both login and OTP send.

**A02/A05 Secrets.** Seven secrets (JWT access/refresh, Razorpay key + webhook,
R2 key id + secret, Google OAuth secret) were searched across six response
surfaces including error paths — **42/42 absent**.

**Error hygiene.** No stack frames, SQL, `PrismaClient`, `node_modules`, or
filesystem paths in any response, including 404s, validation errors, and
unauthenticated errors.

**A09 Redaction.** Candidate phone, candidate email, access-token material, and
all seven secrets were searched across the **last 500 audit rows** and the
**entire server log** — 20/20 absent from both. The no-PII-in-logs rule holds
under adversarial reading, not just by convention.

**A05 CORS.** An arbitrary `Origin` is not reflected, and `ACAO` is never `*`
while credentials are enabled.

**A10 SSRF / arbitrary object access.** The document-confirm path refuses a
foreign candidate's key, a path-traversal key, an absolute filesystem path, and
an AWS metadata URL (`169.254.169.254`) — the prefix ownership check holds.

---

## 11. Deliverables

```
security/probes/
  endpoint-inventory.ts      # live Nest introspection → the endpoint list
  authz-sweep.ts             # every endpoint × every role (753 checks)
  idor-sweep.ts              # horizontal privilege, all resource types
  privacy-probes.ts          # omission, invisibility, gate ordering
  injection-probes.ts        # FTS SQL, XSS, oversize, PDF template
  webhook-probes.ts          # signature tampering + raw-body scoping
  auth-config-probes.ts      # auth, secrets, redaction, CORS, headers, SSRF
  render-authz-matrix.ts     # generates docs/authz-matrix.md
  lib/{env,api,fixtures,report}.ts
  out/                       # machine-readable evidence (gitignored)
docs/security-audit-report.md
docs/authz-matrix.md         # GENERATED — never hand-edited
```

Run individually (`pnpm security:authz`, `:idor`, `:privacy`, `:injection`,
`:webhook`, `:authconfig`) or all at once with **`pnpm security:all`**.
Regenerate the matrix with `pnpm security:authz && pnpm security:matrix`.

The matrix is **generated, not hand-maintained**: a hand-written table drifts the
moment an endpoint is added, and a stale authorization matrix is worse than none
— it claims coverage that no longer holds.

### Fixes committed

| Finding | Files |
|---|---|
| SEC-001 | `jobs/jobs.service.ts` (+ `jobs.service.spec.ts`: 3 tests corrected, 4 added) |
| SEC-002 | `jobs-search/dto/search-query.dto.ts` |
| SEC-003 | `core/http-problem.filter.ts` |
| SEC-004 | `resume/templates/resume.template.ts` (+ 3 regression tests) |
| SEC-005 | `main.api.ts`, `helmet` dependency |

### Regression verification

`pnpm typecheck` clean · `pnpm lint` 0 errors · `pnpm security:typecheck` clean ·
**1,046 / 1,049 API tests passing.**

The three non-passing results are accounted for, and none is a regression from
this unit's changes:

| Result | Cause |
|---|---|
| 1 skipped | Pre-existing skip. |
| `PassportExpiryProcessor › notification data carries correct expiryDate…` | **Pre-existing, date-dependent.** The test hard-codes `daysRemaining: 3` and computes 2 at the current date. Confirmed by `git stash`-ing all S8-H2 changes and re-running: it fails identically on unmodified source. Untouched by this unit. |
| One rotating suite per full run | **Environmental flakiness, not a defect.** Across four full runs the second failure moved between `resume-render`, `invoice-render`, and `purge` — each of which **passes in isolation** (15/15, 4/4, 33/33). Cause is resource contention when Testcontainers Postgres instances and the Chromium pool run concurrently across parallel jest workers, consistent with the memory profile measured in S8-H1. |

Both are worth fixing (pin the passport test's clock; consider `--runInBand`
for the container-backed suites in CI) but they are outside a security unit's
scope and are recorded here rather than silently absorbed.

### Recommended follow-ups (not done here)

1. **Next.js 15 migration** (SEC-006) — its own unit; SSRF and image-optimizer
   DoS are live exposure until then.
2. **Redis-backed rate limiting** (SEC-007) before the API runs more than one
   replica — limits are currently per-process.
3. **Contract-test the 404-not-403 convention.** SEC-001 existed because three
   tests *asserted the vulnerable behaviour*. A shared assertion helper for
   "foreign resource is indistinguishable from nonexistent" would make the next
   instance fail in CI rather than in an audit.
4. Wire `pnpm security:all` into CI as a merge gate, so the 1,025 checks run on
   every change rather than once a sprint.

---

## 12. Scope and limitations

- Probes run against a **single-replica local deployment**. Multi-replica
  behaviour (notably the per-replica rate limiting, SEC-007) is reasoned about,
  not measured.
- The **timing-oracle check is coarse** — a median over 9 requests on a loaded
  dev box, flagging only gross differences (>3× and >40ms). It would catch a
  "row found then filtered" versus "no row" split; it would not catch a
  microsecond-scale side channel.
- **Dependency triage is reachability-based reasoning**, not exploitation. No
  advisory was weaponised to confirm exploitability.
- The **web tier was not probed directly.** This audit covers the API; the
  Next.js app's own surface (client bundle contents, CSP, SSR data exposure)
  deserves its own pass. The one web-tier item raised here (SEC-006) comes from
  dependency analysis, not from probing the running frontend.
- The authz sweep exercises mutating verbs against **probe-owned fixtures on a
  disposable database**. It must not be pointed at production data.
