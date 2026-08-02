/**
 * BullMQ worker polling tuning — the Redis COMMAND-BUDGET knobs.
 *
 * WHY THIS FILE EXISTS
 *
 * A BullMQ worker is never truly idle. When its queue is empty it long-polls
 * with `BZPOPMIN <queue>:marker <drainDelay>`, and it runs a stalled-job check
 * every `stalledInterval`. Both fire forever, whether or not a single job is
 * ever enqueued. At BullMQ's defaults (drainDelay 5s, stalledInterval 30s) ONE
 * idle worker costs 14 Redis commands/minute — ~605k/month. With 8 workers that
 * is ~4.8M commands/month spent on an empty system.
 *
 * On a self-hosted Redis that is free. On a per-command plan (Upstash) it is the
 * entire budget, which is exactly what exhausted ours: the free tier's 500k/month
 * works out to 11.6 commands/minute for the WHOLE platform.
 *
 * WHY RAISING drainDelay COSTS NO LATENCY
 *
 * This is the load-bearing fact. In BullMQ v5 a worker does not discover new
 * work by polling — `Queue.add()` pushes a MARKER that wakes the blocked
 * `BZPOPMIN` immediately. `drainDelay` is only the timeout on that block: how
 * long an IDLE worker waits before looping round to block again. Raising it
 * from 5s to 60s does not delay job pickup by one millisecond; it only means a
 * worker with nothing to do wakes up 12× less often to discover it still has
 * nothing to do.
 *
 * It remains a safety net (if a marker is ever missed, the timeout is the
 * backstop), which is why these are seconds and not hours.
 *
 * TWO TIERS
 *
 * Queues differ in how fast they must react to a MISSED marker, not to a normal
 * one — so the tiers are about worst-case recovery, not throughput:
 *
 *   RESPONSIVE  — notification, resume-render, invoice-render. A human is
 *                 waiting on the other end (a WhatsApp "Selected", a resume
 *                 download, an invoice after checkout).
 *   MAINTENANCE — auto-archive, passport-expiry, subscription-lifecycle,
 *                 account-purge, r2-delete. Fed by daily crons. A five-minute
 *                 worst case on a job that runs at 02:00 is meaningless.
 *
 * Read from `process.env` directly, NOT ConfigService — `@Processor(name, opts)`
 * is evaluated at class-decoration time, before Nest's DI container exists.
 * Same constraint and same precedent as pdf/render-tuning.ts.
 */

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const WORKER_TUNING = {
  /** Idle long-poll timeout, SECONDS, for user-facing queues. BullMQ default: 5. */
  responsiveDrainDelayS: positiveInt(process.env.BULL_DRAIN_DELAY_S, 60),
  /** Idle long-poll timeout, SECONDS, for cron-fed maintenance queues. */
  maintenanceDrainDelayS: positiveInt(process.env.BULL_MAINTENANCE_DRAIN_DELAY_S, 300),

  /**
   * Stalled-job sweep period, MILLISECONDS. BullMQ default: 30_000.
   *
   * This is what recovers a job whose worker died mid-process. It is NOT
   * disabled anywhere (`skipStalledCheck`) — the render queues in particular
   * depend on it to reclaim a job lost to a wedged or OOM-killed Chromium,
   * which is a failure this platform has actually seen (H1). Slowing it down
   * raises recovery latency; switching it off would forfeit recovery entirely.
   */
  responsiveStalledIntervalMs: positiveInt(process.env.BULL_STALLED_INTERVAL_MS, 300_000),
  maintenanceStalledIntervalMs: positiveInt(
    process.env.BULL_MAINTENANCE_STALLED_INTERVAL_MS,
    600_000,
  ),
} as const;

/** Queues a human is waiting on. ~1.2 Redis commands/minute per worker when idle. */
export const RESPONSIVE_WORKER_OPTS = {
  drainDelay: WORKER_TUNING.responsiveDrainDelayS,
  stalledInterval: WORKER_TUNING.responsiveStalledIntervalMs,
} as const;

/** Cron-fed queues. ~0.3 Redis commands/minute per worker when idle. */
export const MAINTENANCE_WORKER_OPTS = {
  drainDelay: WORKER_TUNING.maintenanceDrainDelayS,
  stalledInterval: WORKER_TUNING.maintenanceStalledIntervalMs,
} as const;
