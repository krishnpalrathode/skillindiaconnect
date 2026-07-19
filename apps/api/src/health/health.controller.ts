import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../core/redis/redis.provider';
import { PrismaService } from '../core/prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

type Up = 'up' | 'down';

interface HealthResponse {
  status: 'ok' | 'degraded';
  db: Up;
  redis: Up;
  timestamp: string;
}

interface LivenessResponse {
  status: 'alive';
  uptimeSeconds: number;
  timestamp: string;
}

interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  db: Up;
  redis: Up;
  timestamp: string;
}

/**
 * Deadline for every dependency probe (S8-H3).
 *
 * A health endpoint must ALWAYS answer, and answer quickly. Chaos testing found
 * that with Redis stopped this handler never returned at all: `redis.ping()`
 * sat on ioredis' offline queue forever, so the `catch` never ran and the
 * request hung. A probe that hangs is worse than one that fails — the
 * orchestrator learns nothing and the load balancer keeps sending traffic to a
 * wedged instance. The client now carries a `commandTimeout` (CHAOS-001); this
 * race is the belt-and-braces guarantee that these handlers return regardless
 * of what any dependency does.
 */
const PROBE_TIMEOUT_MS = 2_000;

async function probe(work: Promise<unknown>): Promise<Up> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const deadline = new Promise<'down'>((resolve) => {
      timer = setTimeout(() => resolve('down'), PROBE_TIMEOUT_MS);
    });
    return await Promise.race([work.then(() => 'up' as const), deadline]);
  } catch {
    return 'down';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// VERSION_NEUTRAL + excluded from global prefix → reachable at /health (not /api/v1/health).
// Load balancers and k8s probes depend on these paths never changing.
@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The BUSINESS health view — the human/dashboard summary. Always HTTP 200 so
   * a scrape can read the body; `status` distinguishes ok from degraded.
   *
   * S8-H3 fix: `status` was the literal `'ok'` regardless of what the probes
   * found, so a body reporting `db: "down"` still claimed `status: "ok"`.
   * Anything keying on `status` — the obvious field to key on — could never
   * see a problem.
   */
  @Get()
  async check(): Promise<HealthResponse> {
    const [redis, db] = await Promise.all([
      probe(this.redis.ping()),
      probe(this.prisma.$queryRaw`SELECT 1`),
    ]);
    return {
      status: redis === 'up' && db === 'up' ? 'ok' : 'degraded',
      db,
      redis,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * LIVENESS — "is this process alive, or should it be restarted?"
   *
   * Deliberately checks NO dependencies, which is the whole point of separating
   * it from readiness: if Redis is down, restarting the API does not bring Redis
   * back. It only discards warm connections and in-flight requests — and a
   * dependency outage is correlated, so a dependency-checking liveness probe
   * would roll the entire fleet at once, turning a degradation into an outage.
   * This fails only when the event loop is too wedged to serve a constant, which
   * IS the condition a restart fixes.
   */
  @Get('live')
  live(): LivenessResponse {
    return {
      status: 'alive',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * READINESS — "should this instance receive traffic right now?"
   *
   * Postgres is REQUIRED: without it essentially nothing works, so an instance
   * that cannot reach it should leave rotation. Redis is NOT required —
   * CHAOS-001 made every cache path degrade to the database, so an instance
   * with Redis down still serves correct (slower) responses. Pulling instances
   * during a Redis outage would remove the whole fleet for no benefit. Redis
   * state is still reported, for observability rather than for the decision.
   *
   * Returns HTTP 200 in both cases and puts the verdict in `status`, because
   * platforms differ on whether they key on the code or the body; `status` is
   * the stable contract.
   */
  @Get('ready')
  async ready(): Promise<ReadinessResponse> {
    const [redis, db] = await Promise.all([
      probe(this.redis.ping()),
      probe(this.prisma.$queryRaw`SELECT 1`),
    ]);
    return {
      status: db === 'up' ? 'ready' : 'not_ready',
      db,
      redis,
      timestamp: new Date().toISOString(),
    };
  }
}
