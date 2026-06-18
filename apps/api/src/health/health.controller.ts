import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../core/redis/redis.provider';

interface HealthResponse {
  status: 'ok';
  redis: 'up' | 'down';
  timestamp: string;
}

// VERSION_NEUTRAL + excluded from global prefix → reachable at /health (not /api/v1/health).
// Load balancers and k8s liveness probes depend on this path never changing.
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  @Get()
  async check(): Promise<HealthResponse> {
    let redisStatus: 'up' | 'down' = 'down';
    try {
      const pong = await this.redis.ping();
      redisStatus = pong === 'PONG' ? 'up' : 'down';
    } catch {
      // Redis unreachable — report 'down' without throwing.
      // Liveness must not hard-fail on a dependency blip.
    }
    return {
      status: 'ok',
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    };
  }
}
