import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../core/redis/redis.provider';
import { PrismaService } from '../core/prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

interface HealthResponse {
  status: 'ok';
  db: 'up' | 'down';
  redis: 'up' | 'down';
  timestamp: string;
}

// VERSION_NEUTRAL + excluded from global prefix → reachable at /health (not /api/v1/health).
// Load balancers and k8s liveness probes depend on this path never changing.
@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    let redisStatus: 'up' | 'down' = 'down';
    try {
      const pong = await this.redis.ping();
      redisStatus = pong === 'PONG' ? 'up' : 'down';
    } catch {
      // Redis unreachable — report 'down' without throwing.
    }

    let dbStatus: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbStatus = 'up';
    } catch {
      // DB unreachable — report 'down' without throwing.
    }

    return {
      status: 'ok',
      db: dbStatus,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    };
  }
}
