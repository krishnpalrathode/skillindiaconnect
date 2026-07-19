# S8-H3 — Chaos / Failure-Injection Report

Every failure-behaviour promise the architecture makes, tested by **injecting the
real failure** into a running production-like system. Not simulated in unit
tests, not reasoned about — containers stopped, sockets refused, processes
SIGKILLed.

- **Target:** the compiled build (`apps/api/dist`), API and worker as separate
  processes, against real Postgres + Redis + MinIO.
- **External providers:** none contacted. WhatsApp/email are the mock channels;
  the gateway failure is injected at the outbound network boundary so no packet
  reaches Razorpay or Stripe.
- **Re-run:** `pnpm chaos:all` (or `chaos:redis`, `:gateway`, `:storage`,
  `:worker`, `:nofalsesuccess`, `:drill`). Evidence lands in `chaos/out/*.json`.

## Result

**56 of 56 promises hold** after five fixes — 46 across the five failure
scenarios plus 10 in the backup/restore drill, all re-verified on a clean final
run. Every scenario failed at least once before it passed; the findings below
are the value of the exercise.

| Scenario | Checks | Result |
|---|---|---|
| Redis outage | 11 | all hold (after CHAOS-001/002/003) |
| Gateway unreachable (refuse + timeout) | 11 | all hold |
| Storage outage (upload / purge / render) | 8 | all hold |
| Worker crash & OOM-kill | 7 | all hold |
| Never-claim-false-success + DB outage | 9 | all hold (after CHAOS-004) |
| Backup/restore drill | 10 | all hold (see the drill report) |

---

## Findings

| ID | Severity | Title | Status |
|---|---|---|---|
| **CHAOS-004** | **High** | **The WhatsApp→email fallback never fired.** An off-by-one made the failure-fallback branch unreachable, so a failed WhatsApp send reached nobody. | **Fixed** |
| **CHAOS-001** | **High** | A Redis outage **hung** every request that touched it — including `/health`. Unbounded command queueing, no `commandTimeout`. | **Fixed** |
| CHAOS-002 | Medium | Recovery after a Redis outage took up to ~30s because the reconnect backoff was capped there. | **Fixed** |
| CHAOS-003 | Medium | A Redis outage surfaced as `500 INTERNAL_ERROR` — a dependency failure misreported as an application bug. | **Fixed** (now `503 SESSION_VERIFICATION_UNAVAILABLE`) |
| CHAOS-005 | Medium | `/health` reported `status: "ok"` even when it had just found `db: "down"`; no liveness/readiness split existed. | **Fixed** |

---

## CHAOS-004 — The WhatsApp→email fallback never fired (High)

**The promise** (`worker-and-external-sends.md`): *"Fallbacks follow the
notification matrix — WhatsApp-tier events downgrade to email … after send
retries fail. Never silently claim a notification was delivered."*

**Half of that promise was kept and half was silently broken.** The delivery row
was honestly marked `FAILED` — the system never lied. But the downgrade to email
did not happen, so the candidate simply heard nothing.

### Reproduction

Drive a real WhatsApp rejection through the production config (`attempts: 3`):

```
whatsapp_messages row : status=FAILED     ✅ honest
email_messages        : 0 → 0             ❌ the fallback never ran
```

### Root cause

```ts
if (job.attemptsMade >= maxAttempts) {   // never true inside the processor
```

BullMQ increments `attemptsMade` when an attempt **fails**, so while the Nth
attempt is executing the counter still reads N−1. On the final attempt of a
3-attempt job it is `2`, and `2 >= 3` is false. The branch was unreachable for
**every** attempt count.

### Why it survived until now

The unit test asserted the fallback worked — using `attemptsMade: 3` with
`attempts: 3`, a combination the runtime never produces inside the processor.
The test encoded the wrong model of the framework and therefore proved nothing.
This is the same shape as H2's SEC-001, where three tests asserted the
vulnerable behaviour: **a test that mirrors the code's assumption cannot falsify
it.** Only injecting the real failure exposed it.

### Impact

WhatsApp is the primary channel for this platform's candidates, and the
WhatsApp-tier events include *"you have been selected"*. Any WhatsApp failure —
a number that changed, a Meta outage, a template rejection — silently dropped
the notification entirely.

### Fix

`thisAttemptNumber = job.attemptsMade + 1` — "is this the last attempt?", true
exactly once. Verified end-to-end (emails `0 → 1`) and pinned by a
parameterised test walking the boundary across six `(attempts, attemptsMade)`
combinations. **Confirmed to fail against the original code before the fix was
restored.**

---

## CHAOS-001/002/003 — Redis outage (High / Medium / Medium)

### What was found

Stopping Redis did not degrade the API — it **hung** it.

| Probe | Before | After |
|---|---|---|
| Authorization check | **timed out (>20s)** | `503` in ~2s |
| Public search | **timed out (>20s)** | `200`, served from Postgres |
| `GET /health` | **never answered** | `{"status":"degraded","redis":"down"}` |
| Recovery after Redis returns | up to ~30s | **1.0s** |

Root cause: `enableOfflineQueue: true` with **no `commandTimeout`**. While
disconnected, ioredis queues commands indefinitely, so every caller waited
forever — including the health endpoint, whose `try/catch` never ran because the
promise never settled.

**A health probe that hangs is worse than one that fails**: the orchestrator
learns nothing, the load balancer keeps routing to a wedged instance, and hung
requests accumulate until sockets run out.

### Fixes

1. **`commandTimeout: 2000`** — brief blips still ride through the offline queue;
   long outages fail promptly and catchably.
2. **Reconnect backoff capped at 2s** (was 30s). The cap *is* the post-outage
   recovery latency: chaos reproduced Redis answering `PONG` in its container
   while the API still failed requests, purely because it had not retried yet.
3. **Degrade where degradation is correct.** `PermissionService` and
   `SearchCacheService` now treat a cache error as a cache miss and fall through
   to Postgres — the authoritative source. This is a performance degradation,
   never a security one.
4. **Fail closed, honestly, where degradation is impossible.** The session
   revocation list exists **only** in Redis, so it cannot fall back. The choice
   is genuine: failing open would make logout stop meaning logout during an
   outage. It fails closed — now as `503 SESSION_VERIFICATION_UNAVAILABLE`
   rather than a `500` that pages the wrong team.

### The fail-closed result, stated plainly

- ✅ A role lacking a permission is **never** granted it during a cache outage.
- ✅ An unauthenticated request is still `401`.
- ✅ After recovery, the revoked permission is **still** revoked — no stale grant.
- ⚠️ **Accepted trade-off:** a Redis outage makes the *authenticated* API
  unavailable while public routes keep serving. Documented in the runbook, with
  removal (a DB-backed revocation table) recorded as follow-up.

### Deliberately NOT wrapped

`invalidateRoleCache` and `invalidateJobDetail` still propagate their errors. A
swallowed invalidation means a **revoked permission keeps working** or an
archived job keeps being served until the TTL lapses. The caller must hear about
that.

---

## Gateway unreachable — no false activation (11/11)

**The promise** (S5): activation is webhook-only; money is never assumed.

Injected at the outbound network boundary via a `--require` preload, in two
shapes: **refuse** (dead gateway) and **timeout** (overloaded gateway). This
touches zero production code and guarantees no packet leaves for Razorpay — the
failure happens before DNS resolution. Each run asserts the fault was actually
injected, so a scenario that silently failed to inject cannot "pass".

| Property | Refuse | Timeout |
|---|---|---|
| Client response | `502 GATEWAY_ERROR` | `502 GATEWAY_ERROR` |
| Order state | `FAILED`, `gatewayOrderId` null | `FAILED`, `gatewayOrderId` null |
| Invoices / subscriptions / payments | 0 / 0 / 0 | 0 / 0 / 0 |

And recovery: a correctly-signed webhook afterwards activates normally — order
`PAID`, exactly one invoice, one subscription. **A gateway wobble does not
poison the account.**

---

## Storage outage — resumability without corruption (8/8)

**The promise** (S6b-B1): a purge that fails *after* the DB commit is resumable
without corruption.

This is the nastiest shape in the system: the erasure is half-done and the DB no
longer holds the object keys. Injected by stopping MinIO across the R2 step.

| Property | Result |
|---|---|
| DB anonymization commits despite storage being down | ✅ (the legally-required part does not wait on R2) |
| **No false "erased" claim while R2 fails** | ✅ 0 completion-audit rows |
| Resumes and completes after storage returns | ✅ |
| **Exactly one** completion audit across all attempts | ✅ (resumability ≠ double execution) |
| No corruption (status, anonymized email, tombstoned profile) | ✅ |
| Document upload with storage down | ✅ refused, **no phantom document row** |
| Render with storage down | ✅ `FAILED`, `r2Key` null — never falsely `READY` |

**One correction worth recording.** The first version of this scenario asserted
`purgedAt` stays null while R2 fails. That was wrong: `purgedAt` is set *inside*
the DB transaction and is the **resume marker** — it is precisely what lets a
retry skip the DB work and re-enter at the R2 step. Finding it set is the
mechanism working. The honest signal for "the system claims the erasure
finished" is the `account.purged` **completion audit**, and that is what the
check now asserts.

---

## Worker crash / OOM-kill (7/7)

**H1 measured** that render pressure does not *starve* the other consumers.
**H3 tested the harder property**: killing the process does not *lose* their work.

Injected by SIGKILLing the worker **process only** — leaving its Chromium
children orphaned, which is what an OOM killer actually does.

> **Measurement honesty.** The first version used a tree-kill (`taskkill /T`),
> which reaps Chromium on the test's behalf — the zombie check would have passed
> while proving nothing. Similarly, the first Chromium counter matched every
> `chrome.exe` on the machine (~35 from the operator's own browser) and was pure
> noise. It now matches on the Puppeteer cache path. Both corrections turned a
> vacuous green into a real measurement.

| Property | Result |
|---|---|
| Chromium during render → after an OOM-kill | 11 → **0** (children do not survive the parent) |
| In-flight renders redelivered after restart | **6/6 READY** |
| **A notification queued before the crash still delivered** | ✅ — H1's blast radius under a real crash |
| **Idempotency across crash-restart** | ✅ order `PAID`, **1** invoice, **1** subscription, **1** payment |
| Exactly one GST invoice number issued | ✅ |

That fourth row is the subtle one: the `(provider, eventId)` dedupe and the
`FOR UPDATE` state re-check hold across a **process restart**, not merely across
concurrent delivery. Redelivering the identical webhook after a crash did not
double-activate, double-invoice or double-charge.

---

## Database outage & the no-false-success discipline (9/9)

| Property | Result |
|---|---|
| Read with the DB gone | ✅ non-2xx — never fabricated or partial data |
| Write with the DB gone | ✅ refused, not optimistically acknowledged |
| **No partial write** after the interrupted transaction | ✅ 0 rows |
| `/health` during the outage | ✅ `degraded`, `db: down` |
| `/health/ready` during the outage | ✅ `not_ready` — traffic stops routing here |
| Recovery without a restart | ✅ **98ms**, same process |
| A failed WhatsApp send | ✅ `FAILED`, never `SENT`/`DELIVERED` |
| The email fallback | ✅ fires (after CHAOS-004) |
| Fire-and-forget failure breaks the read | ✅ it does not |

---

## What this exercise says about the codebase

The architecture's failure-handling is **substantially real**, not aspirational.
Webhook-only activation, purge resumability, queue durability and
crash-restart idempotency all held on first contact with genuine failure —
those are hard properties and they were right.

The failures clustered in one place: **the boundary between a dependency being
slow/absent and the code noticing.** Three of five findings were timeouts,
backoff and status semantics — the parts you cannot get right by reasoning,
only by pulling the plug. The fourth (CHAOS-004) was a framework-semantics
off-by-one that a unit test had confidently blessed.

### Follow-ups (not done here)

1. **Remove the Redis dependency from authenticated availability** (CHAOS-003) —
   a DB-backed or short-TTL-signed revocation scheme would let the authenticated
   API survive a cache outage. Currently an accepted, documented trade-off.
2. **Export DB pool metrics.** `alerts.yml` carries a pool-exhaustion rule (H1's
   risk) that needs `connection_limit` set explicitly and the gauge exported.
3. **Run `pnpm chaos:all` in CI on a schedule.** These checks are only worth what
   their re-run frequency makes them; CHAOS-004 had been live for sprints.

### Verification

`pnpm typecheck` clean · `pnpm lint` 0 errors · `pnpm chaos:typecheck` clean ·
**1,084 / 1,086 API tests passing** · all five scenarios re-run green after the
final build.

The one failing test (`PassportExpiryProcessor … expiryDate and daysRemaining`)
is **pre-existing and date-dependent** — it hard-codes `daysRemaining: 3` and
computes 2 at the current date. Confirmed during S8-H2 by stashing all changes
and re-running: it fails identically on unmodified source. It is untouched by
this unit.
