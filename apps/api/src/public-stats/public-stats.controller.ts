/**
 * Public platform stats.
 *
 * GET /stats — unauthenticated; feeds the landing-page stats bar. Rate-limited
 * like search, since it is equally anonymous and the web caches it anyway.
 */
import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMITS } from '../core/config/rate-limits';
import { Public } from '../auth/decorators/public.decorator';
import { PublicStatsService } from './public-stats.service';

@Controller('stats')
export class PublicStatsController {
  constructor(private readonly statsService: PublicStatsService) {}

  @Get()
  @Public()
  @Throttle({ default: RATE_LIMITS.search })
  async get() {
    return { data: await this.statsService.getStats() };
  }
}
