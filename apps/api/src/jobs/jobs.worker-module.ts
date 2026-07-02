import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { JobLifecycleService } from './job-lifecycle.service';
import { JobsCron } from './jobs.cron';
import { AutoArchiveProcessor } from './auto-archive.processor';

/**
 * Worker-process side of the Jobs module.
 *
 * Responsibilities:
 * - JobsCron: @Cron daily handler — enqueues auto-archive job with deterministic
 *   jobId (per cron-queue-dedupe.md). Never works inline.
 * - AutoArchiveProcessor: BullMQ consumer — does the actual ACTIVE→ARCHIVED sweep.
 *
 * MUST be imported only by AppWorkerModule — never by AppApiModule.
 * Importing it in the API process would start a BullMQ worker in-process,
 * causing duplicate archiving runs.
 *
 * AuditModule is @Global — AuditService is auto-injectable.
 * CoreModule (PrismaService) is @Global — no explicit import needed.
 */
@Module({
  imports: [
    QueueModule,  // BullMQ connection + AUTO_ARCHIVE queue registration
  ],
  providers: [
    JobLifecycleService,      // batchAutoArchive logic used by the processor
    JobsCron,                  // @Cron → enqueue
    AutoArchiveProcessor,      // BullMQ processor → archive
  ],
})
export class JobsWorkerModule {}
