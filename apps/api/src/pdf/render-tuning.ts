/**
 * S8-H1 — the render pipeline's tuning knobs, in ONE place.
 *
 * These were hard-coded constants in S7-B1. Load testing (docs/performance-report.md)
 * proved the safe ceiling is instance-size dependent, so they are now env-tunable
 * with the S7-B1 values as defaults — an unset environment behaves exactly as before.
 *
 * Read from `process.env` directly, NOT ConfigService: `@Processor(name, { concurrency })`
 * is evaluated at class-decoration time, before Nest's DI container (and therefore
 * ConfigService) exists. In deployed environments these arrive as real process env
 * vars, so nothing is lost; a local `.env`-only value would NOT be picked up here,
 * which is why the defaults are the production-safe values rather than test values.
 *
 * The sizing relationship that matters (measured, see the report):
 *
 *   peak Chromium RSS ≈ BROWSER_BASE + (concurrent renders × PAGE_COST)
 *
 * so RENDER_POOL_CONCURRENCY is the memory knob and must be set against the
 * worker container's memory limit — NOT against desired throughput.
 */

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const RENDER_TUNING = {
  /**
   * The hard memory ceiling: how many pages may be open across the WHOLE worker
   * (shared by the resume and invoice processors). Renders beyond this queue on
   * the pool's semaphore; they never spawn another browser.
   */
  maxConcurrentRenders: positiveInt(process.env.RENDER_POOL_CONCURRENCY, 2),

  /** A healthy render is ~1-3s; at this point the page is genuinely wedged. */
  renderTimeoutMs: positiveInt(process.env.RENDER_TIMEOUT_MS, 30_000),

  /** Relaunch the shared browser after this many renders, to cap leak growth. */
  recycleAfterRenders: positiveInt(process.env.RENDER_RECYCLE_AFTER, 50),

  /**
   * BullMQ per-queue fetch concurrency. These bound how many render jobs are
   * IN FLIGHT; the pool semaphore above bounds how many actually hold a page.
   * Keeping (resume + invoice) ≤ maxConcurrentRenders means jobs wait in Redis
   * rather than inside the worker process — which is what keeps the OTHER
   * consumers (payment webhooks, notifications, crons) responsive under render
   * pressure. See the blast-radius section of the performance report.
   */
  resumeRenderConcurrency: positiveInt(process.env.RESUME_RENDER_CONCURRENCY, 1),
  invoiceRenderConcurrency: positiveInt(process.env.INVOICE_RENDER_CONCURRENCY, 1),
} as const;
