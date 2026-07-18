import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { NotificationService } from '../notifications/notification.service';
import { PassportExpiryCron } from './passport-expiry.cron';
import { PassportExpiryProcessor } from './passport-expiry.processor';

/**
 * Worker-process side of the Candidate module.
 *
 * Responsibilities:
 * - PassportExpiryCron: @Cron daily → enqueues a PASSPORT_EXPIRY job with a
 *   deterministic jobId (per cron-queue-dedupe.md). Never works inline.
 * - PassportExpiryProcessor: BullMQ consumer — batched passport scan + once-per-window
 *   notification fan-out via NotificationService.
 *
 * NotificationService is provided directly here (not via NotificationModule which
 * carries HTTP controllers). QueueModule registers both PASSPORT_EXPIRY and
 * NOTIFICATION queues, satisfying the @InjectQueue tokens needed by each service.
 *
 * MUST be imported only by AppWorkerModule — never by AppApiModule.
 * CoreModule (PrismaService) and AuditModule (AuditService) are @Global.
 */
@Module({
  imports: [
    QueueModule, // registers PASSPORT_EXPIRY + NOTIFICATION queues
  ],
  providers: [
    NotificationService,        // fan-out entry point used by the processor
    PassportExpiryCron,          // @Cron → enqueue
    PassportExpiryProcessor,     // BullMQ processor → scan + notify
  ],
})
export class CandidateWorkerModule {}
