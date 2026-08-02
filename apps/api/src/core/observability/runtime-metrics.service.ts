/**
 * S8-H3 — process/runtime and queue collectors.
 *
 * These are the metrics H1 and H3 made necessary:
 *
 *  - PROCESS MEMORY (RSS). H1 measured peak worker memory at 515–680MB against
 *    a 1GB budget with the Chromium pool at its default cap, and established
 *    that an OOM there takes payment webhooks and notifications down with it.
 *    An alert on this is the difference between seeing the problem coming and
 *    reading about it in a post-mortem.
 *
 *  - PER-QUEUE DEPTH AND OLDEST-JOB AGE. H1's blast-radius question, made
 *    continuously observable. Depth alone is not enough: a queue can sit at a
 *    modest depth while its oldest job ages for an hour, which is exactly what
 *    starvation looks like. Age is the metric that catches it.
 *
 * Collected on a timer rather than on scrape so a slow Redis cannot stall the
 * /metrics endpoint — the scraper must always get an answer, even (especially)
 * when a dependency is unhealthy.
 *
 * ── TWO TIMERS, NOT ONE (Redis command budget) ──────────────────────────────
 *
 * These two collectors have nothing in common except that they were once on the
 * same interval, and that cost us the entire Upstash monthly quota.
 *
 *   PROCESS gauges are pure in-memory reads. They are free, so they stay fast.
 *   QUEUE gauges are 4-5 Redis commands PER QUEUE PER TICK. At 8 queues on a
 *   15s timer that is 160 commands/minute — ~6.9M/month, from ONE process,
 *   against a 500k/month plan.
 *
 * Worse, this ran in BOTH the API and the worker. `bull:*` keys are GLOBAL, so
 * both processes were reading the same keys and reporting identical numbers:
 * half the spend bought literally nothing. Queue collection is now worker-only.
 *
 * The interval is deliberately coarse. Queue DEPTH is a trend signal feeding an
 * alert threshold, not a debugging tool — nobody makes a decision on the
 * difference between a 15-second-old and a 10-minute-old depth reading, and the
 * alert rules in observability/alerts.yml are written against sustained
 * conditions, not single samples.
 */
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { MetricsService } from './metrics.service';

/** In-memory only (RSS, heap, uptime). No I/O, so this stays cheap and frequent. */
const PROCESS_INTERVAL_MS = Number(process.env.METRICS_PROCESS_INTERVAL_MS ?? 15_000);

/** Redis-backed. Every tick costs 4-5 commands per queue — see the note above. */
const QUEUE_INTERVAL_MS = Number(process.env.METRICS_QUEUE_INTERVAL_MS ?? 600_000);

/** Which BullMQ state keys to count, and the metric label for each. */
const QUEUE_STATES: { suffix: string; state: string; type: 'list' | 'zset' }[] = [
  { suffix: 'wait', state: 'waiting', type: 'list' },
  { suffix: 'active', state: 'active', type: 'list' },
  { suffix: 'delayed', state: 'delayed', type: 'zset' },
  { suffix: 'failed', state: 'failed', type: 'zset' },
];

@Injectable()
export class RuntimeMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeMetricsService.name);
  private processTimer: NodeJS.Timeout | undefined;
  private queueTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly metrics: MetricsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    this.collectProcess();
    this.processTimer = setInterval(() => this.collectProcess(), PROCESS_INTERVAL_MS);
    // Do not hold the event loop open for the sake of metrics.
    this.processTimer.unref?.();

    // Queue depths are global Redis state — exactly one process should pay for
    // reading them, and it should be the one whose health they describe.
    if (this.collectsQueues) {
      void this.collectQueues();
      this.queueTimer = setInterval(() => void this.collectQueues(), QUEUE_INTERVAL_MS);
      this.queueTimer.unref?.();
    }
  }

  onModuleDestroy(): void {
    if (this.processTimer) clearInterval(this.processTimer);
    if (this.queueTimer) clearInterval(this.queueTimer);
  }

  /** The process role, so worker and API series are distinguishable. */
  private get processRole(): string {
    return process.env.SIC_PROCESS_ROLE ?? 'api';
  }

  /**
   * Worker-only by default. `METRICS_QUEUE_COLLECTION=on|off` forces it either
   * way — `on` is the escape hatch for a deployment that runs no worker, `off`
   * silences Redis reads entirely if the command budget ever gets tighter.
   */
  private get collectsQueues(): boolean {
    const override = process.env.METRICS_QUEUE_COLLECTION;
    if (override === 'on') return true;
    if (override === 'off') return false;
    return this.processRole === 'worker';
  }

  /** Both halves, on demand. Used by tests; the timers drive the two separately. */
  async collect(): Promise<void> {
    this.collectProcess();
    if (this.collectsQueues) await this.collectQueues();
  }

  /**
   * Refresh only the in-process gauges (no I/O). The /metrics handler calls
   * this so memory and uptime are exact at scrape time without the scrape ever
   * depending on Redis being reachable.
   */
  collectProcessOnly(): void {
    this.collectProcess();
  }

  private collectProcess(): void {
    const mem = process.memoryUsage();
    const role = this.processRole;
    this.metrics.setGauge(
      'sic_process_resident_memory_bytes',
      'Resident set size of this process in bytes (the H1 OOM ceiling metric)',
      mem.rss,
      { role },
    );
    this.metrics.setGauge('sic_process_heap_used_bytes', 'V8 heap in use in bytes', mem.heapUsed, { role });
    this.metrics.setGauge(
      'sic_process_uptime_seconds',
      'Process uptime in seconds (a reset indicates a crash or redeploy)',
      Math.round(process.uptime()),
      { role },
    );
  }

  /**
   * Queue depth + oldest-job age, read straight from BullMQ's Redis keys.
   *
   * Reading the keys rather than constructing Queue objects avoids opening a
   * second connection per queue purely for observation — the API process is
   * a producer and has no business holding consumer connections.
   */
  private async collectQueues(): Promise<void> {
    for (const queue of Object.values(QUEUE_NAMES)) {
      try {
        let waitDepth = 0;
        for (const { suffix, state, type } of QUEUE_STATES) {
          const key = `bull:${queue}:${suffix}`;
          const depth = type === 'list' ? await this.redis.llen(key) : await this.redis.zcard(key);
          if (suffix === 'wait') waitDepth = depth;
          this.metrics.setGauge(
            'sic_queue_depth',
            'Jobs in a BullMQ queue by state (renders starving other consumers shows up here)',
            depth,
            { queue, state },
          );
        }

        // Age of the oldest WAITING job — the starvation signal. BullMQ stores
        // waiting job ids in a list; the tail is the oldest.
        //
        // Skipped entirely when the queue is empty, which is the overwhelmingly
        // common case: LLEN has ALREADY told us there is no oldest job, so the
        // LINDEX could only ever return nil. That is a free 20% off this
        // collector's steady-state cost, and the probe still runs in full the
        // moment a backlog exists — precisely when the age matters.
        let oldestAgeMs = 0;
        if (waitDepth > 0) {
          const oldestId = await this.redis.lindex(`bull:${queue}:wait`, -1);
          if (oldestId) {
            const ts = await this.redis.hget(`bull:${queue}:${oldestId}`, 'timestamp');
            if (ts) oldestAgeMs = Math.max(0, Date.now() - Number(ts));
          }
        }
        this.metrics.setGauge(
          'sic_queue_oldest_waiting_age_ms',
          'Age of the oldest waiting job — depth alone hides starvation, this does not',
          oldestAgeMs,
          { queue },
        );
      } catch (err) {
        // A metrics collector must never take the process down, and during a
        // Redis outage this WILL fail — which the health endpoint already
        // reports. Logged at debug to avoid flooding the log during an outage.
        this.logger.debug(
          `queue metrics unavailable for ${queue}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
