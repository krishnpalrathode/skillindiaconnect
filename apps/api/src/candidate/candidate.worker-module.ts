import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { R2Module } from '../core/storage/r2.module';
import { NotificationService } from '../notifications/notification.service';
import { PassportExpiryCron } from './passport-expiry.cron';
import { PassportExpiryProcessor } from './passport-expiry.processor';
import { InactivityCron } from './inactivity.cron';
import { InactivityProcessor } from './inactivity.processor';
import { ProfileNudgeCron } from './profile-nudge.cron';
import { ProfileNudgeProcessor } from './profile-nudge.processor';
import { PurgeCron } from './purge/purge.cron';
import { PurgeProcessor } from './purge/purge.processor';
import { PurgeService } from './purge/purge.service';
import { MatchAlertProcessor } from './match-alert.processor';
import { CompletionService } from './completion/completion.service';
import { JobsMatchReadService } from '../jobs/jobs-match-read.service';
import { MatchService } from '../applications/match/match.service';

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
    NotificationService, // fan-out entry point used by the processor
    PassportExpiryCron, // @Cron → enqueue
    PassportExpiryProcessor, // BullMQ processor → scan + notify
    InactivityCron, // @Cron → enqueue the daily 30-day inactivity scan
    InactivityProcessor, // BullMQ processor → scan + "still looking?" fan-out
    // The one-time "finish your profile" nudge, 24h after registering. Hourly
    // rather than daily so "after 24 hours" means 24-25h and not 24-48h.
    // CompletionService (already provided below) supplies the live threshold.
    ProfileNudgeCron, // @Cron → enqueue the hourly nudge scan
    ProfileNudgeProcessor, // BullMQ processor → scan + WhatsApp/email fan-out
    PurgeCron, // @Cron → enqueue the daily sweep
    PurgeProcessor, // BullMQ processor → sweep fan-out + per-user purge
    PurgeService, // the anonymization transaction + R2 destruction
    // Profile-completion job-match alert. The three collaborators are provided
    // DIRECTLY rather than by importing JobsModule/ApplicationsModule, which
    // carry HTTP controllers — the worker root must never load those.
    MatchAlertProcessor, // BullMQ processor → match + notify
    JobsMatchReadService, // Jobs-owned narrow read (Prisma only)
    MatchService, // the same pure scoring engine apply-time uses
    CompletionService, // threshold + mandatory-doc count
  ],
})
export class CandidateWorkerModule {}
