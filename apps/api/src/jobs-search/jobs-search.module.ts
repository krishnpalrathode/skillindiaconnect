/**
 * JobsSearchModule — public job search surface (B6).
 *
 * Owns:
 *  - GET /jobs  (FTS+trgm, filters, cursor pagination)
 *  - GET /jobs/:id  (public detail + similar jobs)
 *  - POST/DELETE /jobs/:id/save  (candidate saved-jobs — only authed/mutating routes)
 *  - Redis search cache with version-bump invalidation
 *  - SearchCacheSubscriber (@OnEvent job.published/paused/archived)
 *
 * saved_jobs table is owned by this module per jobs.module.ts.
 *
 * PrismaService is provided by CoreModule (@Global).
 * EventEmitterModule is set up globally in AppApiModule (@OnEvent works automatically).
 * RedisModule is imported explicitly for REDIS_CLIENT injection in SearchCacheService.
 */
import { Module } from '@nestjs/common';
import { RedisModule } from '../core/redis/redis.module';
import { JobsSearchController } from './jobs-search.controller';
import { JobsSearchService } from './jobs-search.service';
import { SearchCacheService } from './search-cache.service';
import { SearchCacheSubscriber } from './search-cache.subscriber';
import { SavedJobsService } from './saved-jobs.service';

@Module({
  imports: [RedisModule],
  controllers: [JobsSearchController],
  providers: [
    JobsSearchService,
    SearchCacheService,
    SearchCacheSubscriber,
    SavedJobsService,
  ],
})
export class JobsSearchModule {}
