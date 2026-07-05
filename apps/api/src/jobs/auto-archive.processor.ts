import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job as BullJob } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { JobLifecycleService } from './job-lifecycle.service';

/**
 * BullMQ processor for the auto-archive queue.
 *
 * Runs in the WORKER process only. Finds ACTIVE jobs where autoArchiveAt <= now
 * and transitions them ACTIVE→ARCHIVED, batched so a large set doesn't OOM.
 * Each archived job gets a fire-safe audit row via JobLifecycleService.batchAutoArchive.
 *
 * The cron handler in jobs.cron.ts enqueues the job; this processor does the work.
 * BullMQ's deterministic jobId ensures exactly-once execution across worker replicas.
 */
@Injectable()
@Processor(QUEUE_NAMES.AUTO_ARCHIVE)
export class AutoArchiveProcessor extends WorkerHost {
  private readonly logger = new Logger(AutoArchiveProcessor.name);

  constructor(private readonly lifecycle: JobLifecycleService) {
    super();
  }

  async process(job: BullJob): Promise<{ archivedCount: number }> {
    if (job.name !== JOB_NAMES.AUTO_ARCHIVE_JOBS) {
      this.logger.warn(`Unexpected job name "${job.name}" — skipping`);
      return { archivedCount: 0 };
    }

    this.logger.log(`Auto-archive run started (jobId: ${job.id})`);
    const archivedCount = await this.lifecycle.batchAutoArchive();
    this.logger.log(`Auto-archive run complete: ${archivedCount} jobs archived`);

    return { archivedCount };
  }
}
