import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { R2Module } from '../core/storage/r2.module';
import { NotificationService } from '../notifications/notification.service';
import { PassportExpiryCron } from './passport-expiry.cron';
import { PassportExpiryProcessor } from './passport-expiry.processor';
import { PurgeCron } from './purge/purge.cron';
import { PurgeProcessor } from './purge/purge.processor';
import { PurgeService } from './purge/purge.service';

/**
 * Worker-process side of the Candidate module.
 *
 * Responsibilities:
 * - PassportExpiryCron: @Cron daily → enqueues a PASSPORT_EXPIRY job with a
 *   deterministic jobId (per cron-queue-dedupe.md). Never works inline.
 * - PassportExpiryProcessor: BullMQ consumer — batched passport scan + once-per-window
 *   notification fan-out via NotificationService.
 * - PurgeCron / PurgeProcessor / PurgeService (S6b-B1): the DPDP erasure worker —
 *   daily sweep enqueue, per-user anonymization + R2 destruction. This is the
 *   consumer S1-3's DELETE /account enqueue had been waiting for.
 *
 * NotificationService is provided directly here (not via NotificationModule which
 * carries HTTP controllers). QueueModule registers the PASSPORT_EXPIRY,
 * NOTIFICATION and ACCOUNT_PURGE queues, satisfying the @InjectQueue tokens.
 *
 * MUST be imported only by AppWorkerModule — never by AppApiModule.
 * CoreModule (PrismaService), R2Module (StorageService) and AuditModule
 * (AuditService) are @Global.
 */
@Module({
  imports: [
    QueueModule, // registers PASSPORT_EXPIRY + NOTIFICATION + ACCOUNT_PURGE queues
    // R2Module is @Global, but the purge worker must not depend on ANOTHER
    // worker module (payments) happening to import it — own your dependencies.
    R2Module,
  ],
  providers: [
    NotificationService,        // fan-out entry point used by the processor
    PassportExpiryCron,          // @Cron → enqueue
    PassportExpiryProcessor,     // BullMQ processor → scan + notify
    PurgeCron,                   // @Cron → enqueue the daily sweep
    PurgeProcessor,              // BullMQ processor → sweep fan-out + per-user purge
    PurgeService,                // the anonymization transaction + R2 destruction
  ],
})
export class CandidateWorkerModule {}
