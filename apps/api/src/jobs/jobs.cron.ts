import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

/**
 * Schedules the daily auto-archive sweep.
 *
 * PER cron-queue-dedupe.md: this handler does NOTHING but enqueue a BullMQ job
 * with a DETERMINISTIC jobId. No DB reads, no writes, no external calls inline.
 * BullMQ's jobId deduplication makes execution exactly-once across worker replicas.
 * The actual archiving is done by AutoArchiveProcessor.
 */
@Injectable()
export class JobsCron {
  private readonly logger = new Logger(JobsCron.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.AUTO_ARCHIVE) private readonly autoArchiveQueue: Queue,
  ) {}

  @Cron('0 2 * * *')
  async scheduleAutoArchive(): Promise<void> {
    const day = new Date().toISOString().slice(0, 10); // e.g. "2026-07-01"
    const jobId = `auto-archive:${day}`;

    await this.autoArchiveQueue.add(JOB_NAMES.AUTO_ARCHIVE_JOBS, {}, { jobId });
    this.logger.log(`Auto-archive job enqueued for ${day} (jobId: ${jobId})`);
  }
}
