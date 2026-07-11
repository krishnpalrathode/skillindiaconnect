import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { RedisModule } from '../core/redis/redis.module';
import { R2Module } from '../core/storage/r2.module';
import { NotificationService } from '../notifications/notification.service';
import { EmployerService } from '../employer/employer.service';
import { JobLifecycleService } from '../jobs/job-lifecycle.service';
import { SearchCacheService } from '../jobs-search/search-cache.service';
import { SearchCacheSubscriber } from '../jobs-search/search-cache.subscriber';
import { SubscriptionLifecycleCron } from './subscription-lifecycle.cron';
import { SubscriptionLifecycleProcessor } from './subscription-lifecycle.processor';

/**
 * Worker-process side of the Payments module (S5-B3).
 *
 * Responsibilities:
 * - SubscriptionLifecycleCron: @Cron daily → enqueues the sweep with a
 *   deterministic jobId (per cron-queue-dedupe.md). Never works inline.
 * - SubscriptionLifecycleProcessor: BullMQ consumer — the ACTIVE→GRACE→EXPIRED
 *   ladder, T-7/T-1 reminders, and the pause-all-but-most-recent rule.
 *
 * Peer services are provided directly (the CandidateWorkerModule precedent) —
 * importing their API modules would drag HTTP controllers into the worker root:
 * - NotificationService: fan-out entry (QueueModule registers NOTIFICATION).
 * - EmployerService: primary-user resolution for notifications (needs
 *   StorageService — hence R2Module).
 * - JobLifecycleService: the audited ACTIVE→PAUSED transition.
 * - SearchCacheService/Subscriber: job.paused events emitted by pauses IN THIS
 *   PROCESS must bump the search-cache version here — the API-side subscriber
 *   cannot hear a worker-process event.
 *
 * MUST be imported only by AppWorkerModule — never by AppApiModule.
 * CoreModule (Prisma/Redis/Config) and AuditModule are @Global.
 */
@Module({
  imports: [
    QueueModule, // registers SUBSCRIPTION_LIFECYCLE + NOTIFICATION queues
    RedisModule, // REDIS_CLIENT for SearchCacheService
    R2Module, // StorageService for EmployerService
  ],
  providers: [
    NotificationService,
    EmployerService,
    JobLifecycleService,
    SearchCacheService,
    SearchCacheSubscriber,
    SubscriptionLifecycleCron,
    SubscriptionLifecycleProcessor,
  ],
})
export class PaymentsWorkerModule {}
