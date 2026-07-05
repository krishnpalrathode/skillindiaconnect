/**
 * Invalidates the search cache on every job-state transition.
 *
 * A stale cache showing an archived job as ACTIVE (or hiding a just-published
 * one) is a live correctness bug. We bump the search cache version on EVERY
 * job-state event so ALL cached search pages become unreachable immediately.
 * The specific job detail key is also deleted to reflect the new state at once.
 *
 * Errors are swallowed so a Redis blip never crashes the event emitter.
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  JOB_EVENTS,
  JobArchivedPayload,
  JobPausedPayload,
  JobPublishedPayload,
} from '../jobs/jobs.events';
import { SearchCacheService } from './search-cache.service';

@Injectable()
export class SearchCacheSubscriber {
  private readonly logger = new Logger(SearchCacheSubscriber.name);

  constructor(private readonly cache: SearchCacheService) {}

  @OnEvent(JOB_EVENTS.PUBLISHED)
  async onJobPublished(payload: JobPublishedPayload): Promise<void> {
    await this.invalidate(payload.jobId, JOB_EVENTS.PUBLISHED);
  }

  @OnEvent(JOB_EVENTS.PAUSED)
  async onJobPaused(payload: JobPausedPayload): Promise<void> {
    await this.invalidate(payload.jobId, JOB_EVENTS.PAUSED);
  }

  @OnEvent(JOB_EVENTS.ARCHIVED)
  async onJobArchived(payload: JobArchivedPayload): Promise<void> {
    await this.invalidate(payload.jobId, JOB_EVENTS.ARCHIVED);
  }

  private async invalidate(jobId: string, event: string): Promise<void> {
    try {
      await Promise.all([
        this.cache.bumpSearchVersion(),
        this.cache.invalidateJobDetail(jobId),
      ]);
    } catch (err) {
      // Redis failure must not crash the event emitter or roll back the DB write.
      this.logger.error(`[search-cache] invalidation failed for ${event} jobId=${jobId}`, err);
    }
  }
}
