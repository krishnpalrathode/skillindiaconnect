# Redis command budget

Written after the Upstash free plan (500,000 commands/month) was exhausted in
roughly a day and the worker began failing with
`ERR max requests limit exceeded. Limit: 500000`.

The cause was not traffic. The platform was **idle**. This document records what
an idle SkillIndiaConnect actually costs, because that number is not intuitive
and nothing in the code made it visible.

## The budget

```
500,000 commands / month ÷ (30 × 24 × 60 min) = 11.6 commands/minute
```

That is the ceiling for the **entire platform** — both processes, every queue,
every cached permission lookup. It is a much smaller number than it looks.

## What it cost before

| Source | Derivation | cmd/min |
| --- | --- | ---: |
| Queue-depth metrics — worker | 8 queues × 5 cmds × 4 ticks/min | 160 |
| Queue-depth metrics — API | identical, on the same global keys | 160 |
| 7 idle workers long-polling | 7 × (60 ÷ 5s `drainDelay`) | 84 |
| 7 stalled-job sweeps | 7 × (60 ÷ 30s `stalledInterval`) | 14 |
| `/health` → `redis.ping()` | Render probe, ~30s | 2 |
| **Total** | | **≈420** |

**≈18.1M commands/month — 36× the plan.** At that rate the monthly quota is gone
in about 25 hours, which matches what happened.

Two things are worth naming explicitly, because both were invisible:

- **The metrics collector ran in both processes.** `bull:*` keys are global, so
  the API and the worker were reading the same keys and reporting identical
  numbers. Half of the largest line item bought nothing at all.
- **An idle BullMQ worker is not idle.** It long-polls forever. Eight queues
  that receive a handful of jobs a day still cost ~4.8M commands/month to sit
  and wait for them.

## What changed

| Change | Where | Effect |
| --- | --- | --- |
| Queue metrics are worker-only | `core/observability/runtime-metrics.service.ts` | −160 cmd/min |
| Queue metrics on a 10-min timer, split from the (free) process gauges | same | −156 cmd/min |
| Oldest-job age probe skipped when `LLEN` says the queue is empty | same | −20% of what remains |
| `drainDelay` 5s → 60s / 300s, `stalledInterval` 30s → 5min / 10min | `queue/worker-tuning.ts` | −93 cmd/min |
| Render health check → `/health/live` (touches no dependencies) | `render.yaml` | −2 cmd/min |

Note the worker count went **up**, from 7 to 8: `r2-delete` had no consumer at
all, so its jobs had been accumulating unprocessed since S1. Fixing that adds a
worker, and the tuning above absorbs it several times over.

Idle steady state after the change:

| Source | Derivation | cmd/min |
| --- | --- | ---: |
| 3 responsive workers (`drainDelay` 60s) | 3 × 1 | 3.0 |
| 5 maintenance workers (`drainDelay` 300s) | 5 × 0.2 | 1.0 |
| Stalled sweeps (5min / 10min) | 3 × 0.2 + 5 × 0.1 | 1.1 |
| Queue metrics (worker only, 10min, 4 cmds × 8 queues) | 32 ÷ 10 | 3.2 |
| Health probes | `/health/live` touches nothing | 0 |
| **Total** | | **≈8.3** |

**≈358k commands/month against a 500k cap — about 72%**, leaving ~140k/month of
headroom for actual traffic (cached permission lookups, search caching, OTP).

## Why raising `drainDelay` is safe

This is the part that looks wrong and is not.

In BullMQ v5 a worker does **not** discover work by polling. `Queue.add()`
pushes a marker that wakes the blocked `BZPOPMIN` immediately. `drainDelay` is
only the timeout on that block — how long an idle worker waits before looping
round to block again. Raising it from 5s to 60s does not delay job pickup by a
millisecond; it means a worker with nothing to do wakes 12× less often to
discover it still has nothing to do.

It stays a safety net for a missed marker, which is why the values are seconds
and not hours, and why the user-facing queues keep a tighter one than the
cron-fed queues.

## Pipelining does not help

Upstash bills **per command**, not per round-trip. A `MULTI`/pipeline of 40
commands still costs 40. The only levers are **frequency** and **number of keys
touched** — which is why the fixes above are all one or the other, and why no
part of this work batches anything.

## The honest limitation

358k/month leaves ~140k of headroom, and that headroom is what real traffic
spends. It is enough for now and it is not comfortable.

The structural point: BullMQ assumes a Redis you own. Idle workers polling
forever is the architecture, not a defect, and a per-command meter charges rent
on an idle system. Every queue added from here costs ~0.3 cmd/min before it does
any work, and the two knobs above are close to their useful limits.

If the budget gets tight again, the move is not to tune further — it is to run
Redis somewhere that does not meter commands (a Railway Redis service beside the
worker, ~$5/month, also lower latency than a cross-region hop to Upstash).
Prefer that over degrading observability any further.

## Verifying

Watch the Upstash command counter for ten minutes with the platform idle. Expect
roughly **85 commands/10 min**. If it is materially higher, something new is
polling — check for a newly added queue whose processor did not pick up a tier
from `worker-tuning.ts`.
