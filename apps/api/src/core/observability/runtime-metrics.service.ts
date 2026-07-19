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
 */
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { MetricsService } from './metrics.service';

const COLLECT_INTERVAL_MS = Number(process.env.METRICS_COLLECT_INTERVAL_MS ?? 15_000);

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
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly metrics: MetricsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    void this.collect();
    this.timer = setInterval(() => void this.collect(), COLLECT_INTERVAL_MS);
    // Do not hold the event loop open for the sake of metrics.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The process role, so worker and API series are distinguishable. */
  private get processRole(): string {
    return process.env.SIC_PROCESS_ROLE ?? 'api';
  }

  async collect(): Promise<void> {
    this.collectProcess();
    await this.collectQueues();
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
        for (const { suffix, state, type } of QUEUE_STATES) {
          const key = `bull:${queue}:${suffix}`;
          const depth = type === 'list' ? await this.redis.llen(key) : await this.redis.zcard(key);
          this.metrics.setGauge(
            'sic_queue_depth',
            'Jobs in a BullMQ queue by state (renders starving other consumers shows up here)',
            depth,
            { queue, state },
          );
        }

        // Age of the oldest WAITING job — the starvation signal. BullMQ stores
        // waiting job ids in a list; the tail is the oldest.
        const oldestId = await this.redis.lindex(`bull:${queue}:wait`, -1);
        let oldestAgeMs = 0;
        if (oldestId) {
          const ts = await this.redis.hget(`bull:${queue}:${oldestId}`, 'timestamp');
          if (ts) oldestAgeMs = Math.max(0, Date.now() - Number(ts));
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
