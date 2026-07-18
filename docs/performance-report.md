# S8-H1 — Load & Performance Report

Sprint 8 hardening. Baselines, breaking points, and the tuning applied to the four
critical paths. **No feature work; no new endpoints; no new UI.**

Re-runnable scripts live in [`load/`](../load). Every number below came from those
scripts against the seeded corpus described in §1.

---

## 0. TL;DR — what was found

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | **The public FTS search was Seq Scanning at volume.** `similarity(title, q) > 0.3` is a function call and cannot be indexed, so Postgres evaluated it on all 10k rows. The GIN trgm index was never used. | **High** — 256ms/query, cost grows with corpus size | **Fixed** — switched to the indexable `%` operator. 256ms → 47ms cold, 6.5ms warm; both GIN indexes now used via BitmapOr |
| 2 | **The landing page's sort had no usable index.** `status='ACTIVE' ORDER BY publishedAt DESC` could not use the existing composite (market/categoryId sit between the equality and sort columns). | **Medium** — 13.7ms and linear in corpus size | **Fixed** — added `@@index([status, publishedAt DESC])`. 13.7ms → 0.23ms, reads 71 rows instead of 10,004 |
| 3 | **S7-B1's Chromium memory model understated per-render cost by 2–3×.** The code claimed ~400MB peak at cap 2; measured peak is 515–680MB, and **cap 4 already breaches a 1GB container**. | **High** — sizing guidance was wrong in the direction that OOMs | **Corrected** — measured sizing table in code + §2.3; cap 2 confirmed correct for 1GB |
| 4 | **Blast radius: render pressure does NOT starve the other worker consumers.** Notifications drained in ~110ms whether the pool was idle or saturated with 85 Chromium processes. | Informational — the feared failure mode is absent | **Verified, no change needed** — §2.4 |
| 5 | **Every cached search cost a guaranteed Redis miss.** `search:ver` does not exist until the first job state change, so the version lookup missed on every request forever on a fresh deploy. | **Low** — one wasted round-trip per request | **Fixed** — version memoized in-process for 1s. Cache hit rate 50% → 91–99% |
| 6 | Concurrent cold-cache searches each ran their own copy of the same query (no single-flight). | **Low** | **Fixed** — request coalescing; 10 concurrent identical misses now run 1 query |
| 7 | Rate limiting is still **in-memory**, i.e. enforced per API replica, not globally. `api-conventions.md` specifies Redis-backed. | **Medium** (pre-existing) | **Not fixed — flagged.** §6.1 |
| 8 | The Prisma connection pool is implicit (`num_cpus × 2 + 1`). Invisible until a burst exhausts it. | **Low** (pre-existing) | **Documented** — explicit sizing guidance added to `.env.example`; §6.2 |

Correctness invariants held under every load applied: **zero duplicate invoice
numbers** across 803 concurrent activations, **exactly one activation** per order
under 50 simultaneous duplicate webhook deliveries, and **exactly one application
row** under 50 simultaneous same-job applies.

---

## 1. Methodology

### 1.1 Environment

| | |
|---|---|
| Host | Windows 11, 8 logical CPUs, single box |
| Postgres | 16 (Docker, `docker-compose.yml`), port 5433 |
| Redis | 7 (Docker) |
| Object storage | MinIO (Docker) — stands in for Cloudflare R2 |
| API / worker | Production builds (`nest build`), run from `dist/` as separate processes |
| Node | v22.17.1 |

**This is the report's main limitation.** The database, cache, object store,
application under test, and the load generator all share 8 cores. Absolute
throughput is therefore a *lower bound*, not a production forecast. What IS
trustworthy: query plans, memory measurements, correctness-under-concurrency
results, and before/after comparisons where only one variable changed.

A concrete symptom of this: in long multi-level runs, one level per run showed a
multi-second stall that also affected the ~98%-cache-hit detail path (a path that
barely touches Postgres). Re-running that same level *in isolation* was
consistently fast (p95 35ms vs p95 10,845ms). The stall is host contention, not
an application property. **Per-level numbers in §3 were therefore collected as
separate process invocations**, one connection level per run.

### 1.2 External providers — nothing live was contacted

This is a hard requirement of the unit and was satisfied structurally, not by
convention:

| Provider | Wiring under load | Where |
|---|---|---|
| Meta WhatsApp | `MockWhatsappChannel` | `notifications/channels/whatsapp.mock.ts` (the only binding in `channels.module.ts`) |
| AWS SES | `MockEmailChannel` | `notifications/channels/email.mock.ts`; the real `SesEmailAdapter` is still a stub that throws |
| Razorpay | **Inbound only.** `webhook-load.ts` builds the `payment.captured` envelope itself and signs it with HMAC-SHA256 over the raw bytes using the local `RAZORPAY_WEBHOOK_SECRET` — exactly what `RazorpayAdapter.verifyWebhook` verifies. No outbound call; no gateway API key used. Orders are created directly in the DB, because checkout is the one path that legitimately calls the gateway and is deliberately **not** load-tested. |
| Cloudflare R2 | Local MinIO over the same S3 API |

### 1.3 Seeded corpus

`pnpm load:seed` (idempotent; `--reset` / `--purge` supported):

| Entity | Count |
|---|---|
| Jobs | 10,015 (10,004 ACTIVE) |
| Candidate profiles | 20,027 |
| Applications | 50,000 |
| Companies | 207 |
| Work-experience rows | 49,917 |
| Skill rows | 100,000 |
| Candidate documents | 60,000 |

Two deliberate choices:

- **Job text is generated from a trade/city/skill vocabulary**, not one repeated
  string. An FTS index over 10k identical descriptions has a term distribution
  nothing like production and would make the query plan meaningless.
- **Candidates carry real work history and skills.** A resume rendered from an
  empty profile is a near-blank page that costs far less time and memory than a
  real one — it would understate the Chromium pool's ceiling, which is the
  primary thing this unit exists to measure.

`ANALYZE` runs at the end of seeding; without fresh statistics, `EXPLAIN` at
volume lies.

### 1.4 Tooling

Hand-rolled drivers (`load/lib/harness.ts`) rather than k6/artillery/autocannon:

- **k6 and artillery** need a separate binary/runtime; the Chromium test is not
  HTTP at all (it drives BullMQ and samples OS memory), so it could not use them.
- **autocannon** was used initially and removed: its summary exposes p50/p90/p97.5/p99
  but **not p95**, which this unit is required to report. The in-house driver keeps
  raw latency samples, so p50/p95/p99 are exact and the four scripts are directly
  comparable.

Memory is sampled as the **whole process tree** (`load/lib/sample-tree-memory.ps1`),
not the worker's own RSS. Chromium runs as *child* processes; sampling only Node's
RSS would have reported ~120MB while the tree was using 2.5GB.

Auth tokens are minted directly (`mintAccessToken`) rather than via `POST /auth/login`,
which is rate-limited to 5/min/IP — logging in would have measured the throttler.

---

## 2. Chromium pool — the priority target

`pnpm load:chromium` · `load/chromium-pool-burst.ts`

The question is not "how fast is one resume". It is: at what concurrency does
memory become unsafe, does the cap/queue/timeout/recycle hold that line, and does
render pressure starve the rest of the worker.

Each level runs against a **fresh worker process** (BullMQ concurrency and the pool
cap are both fixed at process start, so they cannot be varied without a restart),
preceded by an unmeasured warm-up burst that absorbs Chromium launch, V8 JIT and
Prisma's cold path.

### 2.1 Phase A — does the cap hold? (pool cap pinned at 2)

In-flight render jobs climb 32×; the pool cap stays at the S7-B1 value of 2.

| Queue concurrency | Renders | OK | Failed | p50 | p95 | Throughput | **Peak tree** | Chromium procs |
|---|---|---|---|---|---|---|---|---|
| 1 | 24 | 24 | 0 | 7.4s | 13.9s | 96/min | **505MB** | 10 |
| 2 | 24 | 24 | 0 | 4.7s | 12.4s | 111/min | **600MB** | 13 |
| 4 | 24 | 24 | 0 | 4.3s | 11.4s | 120/min | **608MB** | 16 |
| 8 | 32 | 32 | 0 | 6.2s | 12.5s | 149/min | **633MB** | 13 |
| 16 | 64 | 64 | 0 | 11.6s | 22.2s | 162/min | **636MB** | 12 |
| 32 | 128 | 128 | 0 | 33.0s | 63.3s | 113/min | **678MB** | 16 |

**The cap holds.** A 32× increase in in-flight work produced a 34% increase in peak
memory and no change in the Chromium process count. Surplus renders queued on the
semaphore instead of spawning pages. Zero failures at every level. Latency degrades
(p95 13.9s → 63.3s) but *gracefully* — work is delayed, never dropped, and never at
the cost of the memory ceiling. This is exactly the designed behaviour.

### 2.2 Phase B — where is the ceiling? (cap raised in lockstep)

| Pool cap | OK | Failed | **Peak tree** | Chromium | Procs | Verdict vs a 1GB worker |
|---|---|---|---|---|---|---|
| 1 | 24 | 0 | 555MB | 456MB | 11 | OK |
| 2 | 24 | 0 | 515MB | 466MB | 16 | **OK — recommended** |
| 4 | 24 | 0 | **1095MB** | 1026MB | 26 | **UNSAFE — breaches 1GB** |
| 8 | 32 | 0 | **1789MB** | 1717MB | 44 | UNSAFE |
| 16 | 64 | 0 | **2497MB** | 2422MB | 58 | UNSAFE |
| 32 | 104 | **24** | **2536MB** | 2459MB | 85 | **BREAKING POINT** |

**The breaking point is pool cap 32**, where 24 of 128 renders failed after
exhausting their three attempts. The pool's own defences are visible in the logs
at exactly the levels where they should be:

```
cap=16:  launches=2  force-kills=1     ← one wedged render reaped by the 30s timeout
cap=32:  launches=6  force-kills=5     ← five reaped; the pool relaunched each time
```

This is the wedge-breaker working under genuine distress: renders that hung under
memory pressure hit `RENDER_TIMEOUT_MS`, were SIGKILLed, and the pool relaunched
lazily — **104 of 128 renders still succeeded on a worker whose Chromium tree was
using 2.5GB.** It degraded; it did not collapse.

The recycle is equally visible: Phase A at 64 and 128 renders shows exactly one
`recycling browser after 50+ renders` each, as `RECYCLE_AFTER_RENDERS = 50` requires.

> **Honest caveat on "unsafe".** The test host has far more RAM than a 1GB
> container, so the process was never actually OOM-killed by the OS. "UNSAFE"
> means *the tree's memory demand exceeded the stated container budget* — which
> in a real 1GB container is an OOM kill. The failures at cap 32 are real
> observed failures; the OOM itself is inferred from the measured demand.

### 2.3 The sizing law (this is the correction to S7-B1)

`browser-pool.service.ts` documented ~150MB browser + 50–120MB per page ⇒ ~400MB
peak at cap 2. **Measured peak is 515–680MB**, and the curve is:

| Pool cap | 1 | 2 | 4 | 8 | 16 |
|---|---|---|---|---|---|
| Peak tree | 555MB | ~515–680MB | 1095MB | 1789MB | 2497MB |

Each additional concurrent render costs roughly **150–300MB**, i.e. 2–3× the
original estimate. The estimate was wrong in the dangerous direction: it implied
headroom that does not exist. Cap 2 is still the right value for a 1GB worker —
but with ~35% headroom, not the ~60% implied. The code comment has been corrected
in place so the next person sizing this reads measurements, not a guess.

**Recommended production worker sizing:**

| Worker memory | `RENDER_POOL_CONCURRENCY` | `RESUME_RENDER_CONCURRENCY` | `INVOICE_RENDER_CONCURRENCY` | Sustained capacity |
|---|---|---|---|---|
| 512MB | **not viable** — a single render peaks ~500MB | — | — | — |
| **1GB (recommended default)** | **2** | 1 | 1 | ~100–160 renders/min |
| 2GB | 4 | 2 | 2 | ~200 renders/min |
| 4GB | 8 | 4 | 4 | ~250 renders/min |

Keep `resume + invoice ≤ pool cap` so surplus work waits **in Redis** (cheap, and
visible as queue depth) rather than **inside the worker** holding a BullMQ job
lock. Phase A proves the pool survives violating this; the recommendation stands
because queue depth in Redis is observable and a job blocked on a semaphore is not.

Budget for the **recycle overlap**: the soak run peaked at 741MB against a ~515MB
steady peak, because the outgoing browser is still closing while its replacement
launches. Size against the recycle spike, not the steady state.

### 2.4 Blast radius — the most important result in this unit

The worry: the worker is *shared*, so a render-induced OOM takes payment webhooks,
notifications and crons with it. Measured by enqueueing a real notification job
mid-burst and timing how long the worker took to drain it (email channel →
`email_messages` row, so the signal is the worker actually doing the work).

| Pool cap | Queue conc. | Chromium procs | Idle drain | **Drain under saturation** | Ratio |
|---|---|---|---|---|---|
| 2 | 1 | 10 | 121ms | 110ms | 0.9× |
| 2 | 8 | 13 | 122ms | 120ms | 1.0× |
| 2 | 32 | 16 | 107ms | 119ms | 1.1× |
| 4 | 4 | 26 | 107ms | 114ms | 1.1× |
| 8 | 8 | 44 | 124ms | 137ms | 1.1× |
| 16 | 16 | 58 | 390ms | 133ms | 0.3× |
| 32 | 32 | **85** | 132ms | 132ms | 1.0× |

**There is no starvation.** Even with 85 Chromium processes and a 2.5GB tree, the
notification consumer drained in 132ms — indistinguishable from idle. Two
structural reasons:

1. Each BullMQ queue gets its **own Worker with its own concurrency**, so a
   saturated `resume-render` queue does not block the `notification` queue.
2. The render work happens in **Chromium child processes**, not on the worker's
   event loop. Node spends the render mostly awaiting IPC, leaving it free.

**Conclusion: the blast radius is memory, not CPU or scheduling.** No separate
render worker, no dedicated concurrency budget, and no BullMQ queue priorities are
needed. The one thing that *would* take the other consumers down is an OOM kill —
which is precisely why the §2.3 sizing table is the deliverable that matters. The
mitigation for the shared-worker risk is *sizing*, not isolation.

### 2.5 Soak — the leak test

Five consecutive bursts × 30 renders on **one long-lived worker** at the
recommended config (cap 2, resume 1, invoice 1) — `LOAD_MODE=soak`:

| Burst | OK | Failed | Peak | Settled after idle |
|---|---|---|---|---|
| 1 | 30 | 0 | 514MB | 240MB |
| 2 | 30 | 0 | 741MB | 563MB |
| 3 | 30 | 0 | 584MB | 375MB |
| 4 | 30 | 0 | 496MB | 398MB |
| 5 | 30 | 0 | 568MB | 73MB |

150 renders, **zero failures**. Settled memory drifted **−167MB** across the run
(ended *lower* than it started) and peak never trended upward. Three
`recycling browser after 50+ renders` events fired, exactly as expected for 150
renders at a 50-render recycle interval. **No leak.**

---

## 3. Public search (SSR + FTS)

`pnpm load:search` · `load/search-load.ts`

### 3.1 The index findings — `EXPLAIN ANALYZE` at volume

**Finding 1 — the FTS query was Seq Scanning.** Before:

```
Seq Scan on jobs j  (actual time=1.024..252.635 rows=445)
  Filter: status = 'ACTIVE' AND (searchVector @@ ... OR similarity(title, 'electrician') > 0.3)
  Rows Removed by Filter: 9570
Execution Time: 256.313 ms
```

`similarity(a, b) > 0.3` is a **function call**, and no operator class can index
it. Postgres had no choice but to scan every row and evaluate `similarity()` on
each. The `gin_trgm_ops` index on `title` — which exists — was unusable.

The fix is the indexable trgm operator, `title % q`, which is semantically
identical (`%` uses `pg_trgm.similarity_threshold`, whose Postgres default is
0.3 — exactly the literal it replaces). After:

```
Bitmap Heap Scan on jobs j  (actual time=1.082..6.086 rows=445)
  -> BitmapOr
       -> Bitmap Index Scan on "jobs_searchVector_idx"  (rows=447)
       -> Bitmap Index Scan on jobs_title_idx           (rows=1456)
Execution Time: 6.542 ms   (46.9 ms on cold buffers)
```

**256ms → 47ms cold / 6.5ms warm.** Both GIN indexes are now used, and the cost
scales with the number of *matches* rather than the size of the corpus — the
difference that matters as the job count grows.

**Finding 2 — the landing page had no usable index.** `status='ACTIVE' ORDER BY
publishedAt DESC` (no filters — the most-hit shape) could not use
`@@index([status, market, categoryId, publishedAt])`, because `market` and
`categoryId` sit between the equality column and the sort column. It Seq Scanned
all 10,004 ACTIVE rows and top-N sorted them (13.7ms, linear in corpus size).

Added `@@index([status, publishedAt(sort: Desc)])`
(migration `20260718161502_s8h1_jobs_status_published_index`):

```
Index Scan using "jobs_status_publishedAt_idx"  (actual time=0.013..0.094 rows=71)
Execution Time: 0.227 ms
```

**13.7ms → 0.23ms**, reading 71 rows instead of 10,004. `prisma migrate diff`
reports no drift.

> **Ops note for the production deploy:** the migration is a plain `CREATE INDEX`,
> which takes a write lock. At current volume (10k rows) it completes in
> milliseconds. If the table is materially larger at deploy time, this should be
> run as `CREATE INDEX CONCURRENTLY` — which cannot run inside Prisma's
> transaction wrapper and therefore needs the hand-edited-SQL review path in
> `migrations.md`.

### 3.2 Baselines (each connection level = one isolated run)

| Conns | Mix | RPS | p50 | p95 | p99 | Cache hit | Errors |
|---|---|---|---|---|---|---|---|
| 10 | hot | 876 | 11ms | 18ms | 23ms | 99.0% | 0 |
| 10 | cold | 908 | 10ms | 17ms | 29ms | 97.5% | 0 |
| 10 | detail | 1176 | 8ms | 13ms | 31ms | — | 0 |
| 50 | hot | 990 | 49ms | 70ms | 85ms | 96.4% | 0 |
| 50 | cold | 1023 | 47ms | 65ms | 84ms | 96.4% | 0 |
| 50 | detail | 1446 | 34ms | 45ms | 58ms | — | 0 |
| 100 | hot | 934 | 101ms | 154ms | 188ms | 93.4% | 0 |
| 100 | cold | 1084 | 89ms | 121ms | 152ms | 91.7% | 0 |
| 100 | detail | 1675 | 58ms | 73ms | 99ms | — | 0 |

*"hot"* = 6 repeated query shapes (a landing page and its popular filters).
*"cold"* = 34 distinct search terms. Both mixes are reported because only-hot
would flatter the cache and only-cold would libel the query.

**Saturation is ~1,000 rps for search and ~1,400–1,700 rps for job detail.**
Beyond ~50 connections throughput is flat and latency grows linearly with
concurrency — the textbook closed-loop signature of a saturated system. Zero
errors and zero non-2xx at every level; the SSR search path degrades by queueing,
not by failing.

### 3.3 Cache findings

**The hit rate was pinned at almost exactly 50% — and the reason was a bug.**
`getSearchVersion()` reads `search:ver`, a key that **does not exist** until the
first job state change ever calls `bumpSearchVersion()`. Verified directly:
`EXISTS search:ver` → `0` after a full load run. So every search performed one
guaranteed-miss read plus one result read: exactly 1 miss + 1 hit = 50%.

Fixed by memoizing the version in-process for 1s. This is safe because a cached
*result* is already allowed to be up to 60s stale — one second of extra version
staleness cannot make the feed staler than the TTL already permits. It also halves
the Redis round-trips on the hottest public path (the two reads are inherently
sequential: the result key is not knowable until the version returns).

**Measured effect: cache hit rate 50% → 91–99%.**

Two further changes, and an honest account of one that did not work:

- **TTL jitter** (`60s + rand(0..15s)`) was added first, on the hypothesis that a
  cohort of keys written in one burst expired in one second and stampeded the FTS
  query. **The re-run showed the cliff unchanged — the hypothesis was wrong.**
  Jitter is retained as cheap, standard insurance against a real failure mode, but
  it is not credited with fixing anything observed here.
- **Single-flight coalescing** was then added, so N concurrent misses on the same
  key run one query instead of N. Unit-proven (10 concurrent identical cold
  searches → exactly 1 `$queryRaw`). It also **did not** remove the cliff.
- The cliff was ultimately traced to **host contention**, not the application: it
  struck the ~98%-cache-hit detail path too, and vanished when the same level was
  run in isolation (§1.1).

Coalescing required one non-obvious correctness fix worth recording: coalesced
callers share one result object, and `applySavedState` **mutates** the returned
cards to stamp the viewer's `isSaved`. Returning the shared instance would have
leaked one candidate's saved-jobs state into every other viewer's response — a
privacy bug, not merely an aliasing bug. Each caller now receives a
`structuredClone`.

The first version of that fix cloned only on the *producer's* path and handed
waiters the shared object — the very bug it was written to prevent. A two-caller
test could not see it, because the producer and the single waiter take different
paths and so legitimately differ. The test now uses **three** concurrent callers
and asserts every pair is a distinct instance, which forces two callers down the
waiter path and compares them to each other. It was confirmed to fail against the
buggy version before the fix was restored.

---

## 4. Payment webhook path

`pnpm load:webhook` · `load/webhook-load.ts`

### 4.1 Distinct orders — throughput and activation latency

| Concurrency | Requests | RPS | p50 | p95 | p99 | Activated | non-200 |
|---|---|---|---|---|---|---|---|
| 1 | 200 | 25 | 38ms | 49ms | 62ms | 200/200 | 0 |
| 10 | 200 | 80 | 102ms | 231ms | 299ms | 200/200 | 0 |
| 25 | 200 | 79 | 280ms | 460ms | 543ms | 200/200 | 0 |
| 50 | 200 | 72 | 638ms | 931ms | 1196ms | 200/200 | 0 |

A single activation costs **38ms** (one `FOR UPDATE` lock + ~6 writes + 2 audit
rows, all in one transaction). Throughput saturates at **~80 activations/sec** and
concurrency past 10 buys latency, not volume.

The 200-fast property holds up to a point: p99 stays under 1.2s even at 50
concurrent. The activation is deliberately **synchronous** before the 200 (so it
cannot race its own retry), so sustained gateway retry storms above ~80/s would
queue. `WebhookService` already documents where the enqueue seam is if that
becomes real; at expected volumes it is nowhere near.

### 4.2 Lock contention — N duplicate deliveries of the SAME order

This is what the `SELECT … FOR UPDATE` exists for. Each delivery carries a
*distinct* event id so the `webhook_events` dedupe does **not** absorb it — every
request reaches the activation transaction and contends for the row lock.

| Simultaneous deliveries | p50 | p95 | Invoices | Subscriptions | Payment rows | Result |
|---|---|---|---|---|---|---|
| 10 | 95ms | 127ms | **1** | **1** | **1** | exactly one activation |
| 25 | 223ms | 239ms | **1** | **1** | **1** | exactly one activation |
| 50 | 404ms | 413ms | **1** | **1** | **1** | exactly one activation |

Contention cost is ~8ms of serialized work per queued delivery — the lock doing
its job. It is a latency cost, not a correctness one, and it does not grow
super-linearly.

### 4.3 Invoice sequence integrity under concurrent load

The S5-B2 guarantee, tested under real pressure:

```
issued during run : 803
distinct numbers  : 803
DUPLICATES        : 0     ✓
gaps              : 0
range             : SIC-2026-00001 … SIC-2026-00803
```

**803 invoice numbers issued under concurrent activation, zero duplicates.**
`nextval('invoice_number_seq')` never handed two sessions the same number, and the
per-order `FOR UPDATE` lock kept it to one invoice per order. (Gaps would have been
acceptable — Postgres sequences are non-transactional, so a rolled-back activation
burns its number, and GST requires uniqueness and order rather than gaplessness.
There happened to be none, because nothing rolled back.)

---

## 5. Apply + match

`pnpm load:apply` · `load/apply-load.ts`

### 5.1 Spread — distinct (candidate, job) pairs

| Concurrency | Requests | Created | RPS | p50 | p95 | p99 |
|---|---|---|---|---|---|---|
| 1 | 150 | 150 | 31 | 31ms | 40ms | 49ms |
| 10 | 150 | 150 | 106 | 88ms | 123ms | 199ms |
| 25 | 150 | 150 | 113 | 216ms | 293ms | 302ms |
| 50 | 150 | 150 | 149 | 319ms | 382ms | 401ms |

**31ms** for the whole transactional path at rest: five sequential gates (including
an `ALREADY_APPLIED` lookup), the match computation, the snapshot, and the insert.
Saturates around **110–150 applies/sec**. 100% success at every level — no gate
misfired under load, and the match compute is not a bottleneck.

### 5.2 The double-apply race at scale

N simultaneous applies, same candidate → same job. The gate's `findUnique`
pre-check is a read before a write and cannot prevent this; the
`@@unique([jobId, candidateId])` constraint is the actual guarantee.

| Width | Rows created | HTTP 201 | HTTP 409 | Other | Result |
|---|---|---|---|---|---|
| 2 | **1** | 1 | 1 | 0 | correct |
| 5 | **1** | 1 | 4 | 0 | correct |
| 10 | **1** | 1 | 9 | 0 | correct |
| 25 | **1** | 1 | 24 | 0 | correct |
| 50 | **1** | 1 | 49 | 0 | correct |

**The race holds at every width.** Exactly one row, exactly one 201, and every
loser got a clean `409 ALREADY_APPLIED` — the contract code, not a leaked 500 from
a raw constraint violation.

---

## 6. Tuning applied

All previously hard-coded values are now env-tunable **with the pre-S8 values as
defaults**, so an unset environment behaves exactly as before. They are declared
in `packages/shared-config/src/env.schema.ts` and documented in `.env.example`
(`pnpm check:env` enforces that the two agree).

| Setting | Default | Where | Rationale |
|---|---|---|---|
| `RENDER_POOL_CONCURRENCY` | 2 | `pdf/render-tuning.ts` | **Confirmed, not changed.** §2.2 proves 2 is the safe ceiling for a 1GB worker; 4 breaches it |
| `RENDER_TIMEOUT_MS` | 30000 | same | Confirmed — reaped 5 wedged renders at the breaking point and recovered |
| `RENDER_RECYCLE_AFTER` | 50 | same | Confirmed — fired 3× across 150 soak renders, no leak |
| `RESUME_RENDER_CONCURRENCY` | 1 | same | Now explicit (was BullMQ's implicit 1) |
| `INVOICE_RENDER_CONCURRENCY` | 1 | same | Now explicit; shares the pool with resume renders |
| `RATE_LIMIT_GLOBAL_PER_MIN` | 100 | `core/config/rate-limits.ts` | Contract value unchanged; tunable so load runs measure the path, not the throttler |
| `RATE_LIMIT_SEARCH_PER_MIN` | 30 | same | As above |
| Search cache TTL | 60s + 0–15s jitter | `search-cache.service.ts` | Jitter added (see §3.3 for the honest caveat) |
| Search version read | memoized 1s | same | Removes a guaranteed-miss round-trip per request |

Both render knobs and both rate limits are read from `process.env` directly rather
than through `ConfigService`, because `@Processor({ concurrency })` and
`@Throttle({...})` are **decorator arguments** — evaluated at class-decoration
time, before Nest's DI container exists. In deployed environments these arrive as
real env vars so nothing is lost; a `.env`-file-only value would not be picked up,
which is why the defaults are the production-safe values.

### 6.1 Not fixed — rate limiting is per-replica (pre-existing)

`ThrottlerModule` still uses **in-memory** storage. `api-conventions.md` specifies
Redis-backed limiting. With N API replicas the effective global limit is N × the
configured value, and the auth/OTP limits (5/min/IP) are the ones where that
matters most. This was already flagged in a comment in `app-api.module.ts`; it is
out of scope for a perf unit but should not be forgotten before the replica count
goes above 1. Fixing it means swapping in a Redis storage adapter.

### 6.2 DB connection pool — sized explicitly from now on

Prisma defaults to `num_cpus × 2 + 1` per process (17 on the test host). This is
invisible until a burst exhausts it, at which point it surfaces as latency that
looks like an application problem. It was explicitly ruled out as the cause of the
§3 latency cliff (the cliff got *better* at 50 and 100 connections, which pool
exhaustion cannot explain), but the implicitness is itself the hazard.
`.env.example` now documents setting it explicitly:

```
DATABASE_URL=postgresql://…/db?connection_limit=20&pool_timeout=10
```

Size `(api replicas + worker) × connection_limit` under Postgres' `max_connections`
(100 by default).

---

## 7. Deliverables

```
load/
  seed-load-data.ts          # realistic volumes; idempotent, --reset / --purge
  chromium-pool-burst.ts     # the priority test (+ LOAD_MODE=soak leak test)
  search-load.ts             # SSR + FTS, with EXPLAIN ANALYZE at volume
  webhook-load.ts            # signed test-mode webhooks; invoice-sequence audit
  apply-load.ts              # apply throughput + the double-apply race
  lib/harness.ts             # percentiles, worker/API spawn, JWT minting, env
  lib/sample-tree-memory.ps1 # process-TREE memory sampler (node + Chromium)
  tsconfig.json              # `pnpm load:typecheck`
  results/                   # run artifacts (gitignored)
docs/performance-report.md   # this file
```

Scripts: `pnpm load:seed | load:chromium | load:search | load:webhook | load:apply | load:typecheck`.

### Verification

`pnpm typecheck` clean · `pnpm lint` 0 errors · **89 suites / 1041 tests passing**
· `prisma migrate diff` reports no drift · `pnpm check:env` passes.

New tests pinning this unit's behaviour changes: TTL jitter bounds and spread,
version memoization and its invalidation on bump, single-flight coalescing (10
concurrent misses → 1 query), and per-caller object isolation for coalesced
results.

### Suggested follow-ups (not done here)

1. **Re-run against production-like infrastructure.** The correctness and query-plan
   results transfer directly; the throughput numbers are floor values from a
   contended single box (§1.1).
2. **Redis-backed rate limiting** before the API runs more than one replica (§6.1).
3. `CREATE INDEX CONCURRENTLY` for the new index if the jobs table is large at
   deploy time (§3.1).
4. A **worker memory alert** at ~80% of the container limit. The pool holds its
   line, so the realistic path to an OOM is a config change (someone raising
   `RENDER_POOL_CONCURRENCY` for throughput) rather than organic load — an alert
   catches that before it takes payments and notifications down with it.
