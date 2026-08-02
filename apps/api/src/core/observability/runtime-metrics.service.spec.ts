/**
 * RuntimeMetricsService — the Redis COMMAND BUDGET guarantees.
 *
 * These assert on the NUMBER OF REDIS CALLS, not just on the gauges, because
 * the defect this collector caused was never a wrong value — it was 320
 * commands/minute against a 500k/month plan, from a service whose output looked
 * perfectly correct. See docs/redis-command-budget.md.
 */
import { RuntimeMetricsService } from './runtime-metrics.service';
import { MetricsService } from './metrics.service';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import type { Redis } from 'ioredis';

const QUEUE_COUNT = Object.values(QUEUE_NAMES).length;

function makeRedisMock(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    llen: jest.fn().mockResolvedValue(0),
    zcard: jest.fn().mockResolvedValue(0),
    lindex: jest.fn().mockResolvedValue(null),
    hget: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function build(role: string | undefined, redis = makeRedisMock()) {
  if (role === undefined) delete process.env.SIC_PROCESS_ROLE;
  else process.env.SIC_PROCESS_ROLE = role;
  const metrics = new MetricsService();
  const service = new RuntimeMetricsService(metrics, redis as unknown as Redis);
  return { service, metrics, redis };
}

describe('RuntimeMetricsService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  describe('queue collection is worker-only', () => {
    it('reads Redis in the worker process', async () => {
      const { service, redis } = build('worker');
      await service.collect();
      expect(redis.llen).toHaveBeenCalled();
    });

    it('makes ZERO Redis calls in the API process', async () => {
      // bull:* keys are global — the worker already reports these exact numbers.
      // Collecting here bought nothing and cost ~6.9M commands/month.
      const { service, redis } = build('api');
      await service.collect();
      expect(redis.llen).not.toHaveBeenCalled();
      expect(redis.zcard).not.toHaveBeenCalled();
      expect(redis.lindex).not.toHaveBeenCalled();
    });

    it('treats an unset role as the API (the safe default)', async () => {
      const { service, redis } = build(undefined);
      await service.collect();
      expect(redis.llen).not.toHaveBeenCalled();
    });

    it('METRICS_QUEUE_COLLECTION=on forces collection in a non-worker', async () => {
      const { service, redis } = build('api');
      process.env.METRICS_QUEUE_COLLECTION = 'on';
      await service.collect();
      expect(redis.llen).toHaveBeenCalled();
    });

    it('METRICS_QUEUE_COLLECTION=off silences even the worker', async () => {
      const { service, redis } = build('worker');
      process.env.METRICS_QUEUE_COLLECTION = 'off';
      await service.collect();
      expect(redis.llen).not.toHaveBeenCalled();
    });
  });

  describe('per-tick command cost', () => {
    it('costs exactly 4 commands per queue when every queue is empty', async () => {
      const { service, redis } = build('worker');
      await service.collect();

      // 2 lists (wait, active) + 2 zsets (delayed, failed). No LINDEX, no HGET:
      // LLEN already proved there is no oldest job for the age probe to find.
      expect(redis.llen).toHaveBeenCalledTimes(QUEUE_COUNT * 2);
      expect(redis.zcard).toHaveBeenCalledTimes(QUEUE_COUNT * 2);
      expect(redis.lindex).not.toHaveBeenCalled();
      expect(redis.hget).not.toHaveBeenCalled();
    });

    it('still runs the age probe when a queue HAS a backlog', async () => {
      // The saving must not cost us the starvation signal — that is the whole
      // reason the age gauge exists (depth alone hides starvation).
      const redis = makeRedisMock({
        llen: jest.fn().mockImplementation((key: string) => (key.endsWith(':wait') ? 3 : 0)),
        lindex: jest.fn().mockResolvedValue('job-42'),
        hget: jest.fn().mockResolvedValue(String(Date.now() - 60_000)),
      });
      const { service, metrics } = build('worker', redis);
      await service.collect();

      expect(redis.lindex).toHaveBeenCalledTimes(QUEUE_COUNT);
      expect(redis.hget).toHaveBeenCalledTimes(QUEUE_COUNT);
      expect(metrics.render()).toContain('sic_queue_oldest_waiting_age_ms');
    });
  });

  describe('process gauges', () => {
    it('are collected without touching Redis at all', () => {
      const { service, metrics, redis } = build('worker');
      service.collectProcessOnly();

      expect(redis.llen).not.toHaveBeenCalled();
      expect(metrics.render()).toContain('sic_process_resident_memory_bytes');
    });

    it('survive a Redis outage — a scrape must always answer', async () => {
      const redis = makeRedisMock({
        llen: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      });
      const { service, metrics } = build('worker', redis);

      await expect(service.collect()).resolves.toBeUndefined();
      expect(metrics.render()).toContain('sic_process_resident_memory_bytes');
    });
  });
});
