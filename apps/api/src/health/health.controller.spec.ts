import { Test, type TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { REDIS_CLIENT } from '../core/redis/redis.provider';
import { PrismaService } from '../core/prisma/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;
  const mockRedis = {
    ping: jest.fn().mockResolvedValue('PONG'),
  };
  const mockPrisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);

    // Restore the HEALTHY defaults for every test. `clearAllMocks` only clears
    // recorded calls, not implementations, so a persistent `mockRejectedValue`
    // set by one test would silently leak into the next and make it fail for
    // the wrong reason.
    mockRedis.ping.mockReset().mockResolvedValue('PONG');
    mockPrisma.$queryRaw.mockReset().mockResolvedValue([{ '?column?': 1 }]);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns status ok with db up and redis up when both respond', async () => {
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.db).toBe('up');
    expect(result.redis).toBe('up');
    expect(typeof result.timestamp).toBe('string');
  });

  // CHAOS-005 (S8-H3): these two previously asserted `status: 'ok'` WHILE a
  // dependency was reported down — they encoded the bug. `status` was a literal
  // and could never reflect the probes, so anything keying on it (the obvious
  // field to key on) was blind to every outage.
  it('reports DEGRADED, not ok, when Redis is unreachable', async () => {
    mockRedis.ping.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await controller.check();
    expect(result.status).toBe('degraded');
    expect(result.redis).toBe('down');
    expect(result.db).toBe('up');
  });

  it('reports DEGRADED, not ok, when the DB is unreachable', async () => {
    mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await controller.check();
    expect(result.status).toBe('degraded');
    expect(result.db).toBe('down');
    expect(result.redis).toBe('up');
  });

  // ── Liveness / readiness (S8-H3) ────────────────────────────────────────

  describe('liveness', () => {
    it('is alive regardless of dependencies — restarting cannot fix a dependency outage', () => {
      mockRedis.ping.mockRejectedValue(new Error('ECONNREFUSED'));
      mockPrisma.$queryRaw.mockRejectedValue(new Error('ECONNREFUSED'));
      const result = controller.live();
      expect(result.status).toBe('alive');
      expect(typeof result.uptimeSeconds).toBe('number');
      // It must not consult them at all: a dependency-checking liveness probe
      // would roll the whole fleet during a correlated outage.
      expect(mockRedis.ping).not.toHaveBeenCalled();
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('is ready when the database is reachable', async () => {
      const result = await controller.ready();
      expect(result.status).toBe('ready');
    });

    it('is NOT ready when the database is unreachable', async () => {
      mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const result = await controller.ready();
      expect(result.status).toBe('not_ready');
      expect(result.db).toBe('down');
    });

    it('stays READY when only Redis is down — the cache paths degrade to the DB', async () => {
      // Pulling instances during a Redis outage would remove the entire fleet
      // for no benefit: CHAOS-001 made every cache path fall back to Postgres.
      mockRedis.ping.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const result = await controller.ready();
      expect(result.status).toBe('ready');
      expect(result.redis).toBe('down');
    });
  });

  // A probe that HANGS is worse than one that fails: the orchestrator learns
  // nothing and the load balancer keeps routing to a wedged instance. This is
  // the exact failure chaos testing found (ioredis' unbounded offline queue).
  it('always answers, even when a dependency never resolves', async () => {
    mockRedis.ping.mockImplementationOnce(() => new Promise(() => undefined));
    const result = await controller.check();
    expect(result.redis).toBe('down');
    expect(result.status).toBe('degraded');
  }, 10_000);
});
