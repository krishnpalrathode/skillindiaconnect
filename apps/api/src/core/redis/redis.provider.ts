import { type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const RedisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (configService: ConfigService): Redis => {
    const url = configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    const client = new Redis(url, {
      /**
       * Reconnect backoff, capped at 2 s (CHAOS-002, S8-H3).
       *
       * This was capped at 30 s. The cap is the RECOVERY LATENCY after an
       * outage ends: the backoff grows with each failed attempt, so a
       * multi-minute Redis outage pushed later attempts to the 30 s ceiling and
       * the app then kept using the degraded path for up to another 30 s AFTER
       * Redis was healthy again. Chaos testing reproduced exactly that — Redis
       * answered `PONG` inside its container while the API was still failing
       * requests, purely because it had not retried yet.
       *
       * A local Redis reconnect takes milliseconds, so 2 s is generous while
       * bounding post-outage recovery to ~2 s instead of ~30 s. The retry loop
       * itself is cheap; there is nothing to gain from backing off further.
       */
      retryStrategy: (times: number) => Math.min(times * 100, 2_000),
      lazyConnect: false,

      /**
       * CHAOS-001 (S8-H3). `enableOfflineQueue` stays TRUE so a brief blip
       * (a failover, a restart) queues commands and rides through invisibly —
       * that behaviour is worth keeping. What was missing is a BOUND on the
       * wait.
       *
       * With no `commandTimeout`, a queued command waits for reconnection
       * FOREVER. Chaos testing showed the consequence: with Redis stopped,
       * every request touching Redis hung indefinitely instead of failing —
       * including `GET /health`, which never answered at all. A liveness probe
       * that hangs is worse than one that fails: the orchestrator learns
       * nothing, the load balancer keeps routing traffic to a wedged instance,
       * and hung requests pile up until the process exhausts its sockets.
       *
       * 2 s is far above a healthy Redis round-trip (sub-millisecond locally)
       * and far below any user-visible patience threshold, so it converts an
       * unbounded hang into a prompt, catchable error. Every caller that can
       * degrade now does so (see PermissionService and SearchCacheService,
       * which fall back to Postgres); callers that cannot, fail fast and
       * closed.
       */
      commandTimeout: Number(process.env.REDIS_COMMAND_TIMEOUT_MS ?? 2_000),
      connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 5_000),
      enableOfflineQueue: true,
    });
    client.on('error', (err: Error) => {
      // Log but do not crash — health controller reports redis: 'down' instead.
      console.error('[Redis] connection error:', err.message);
    });
    return client;
  },
  inject: [ConfigService],
};
