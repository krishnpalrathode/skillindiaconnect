import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '../../queue/queue.constants';

/**
 * Daily purge sweep — fires at 02:30 UTC.
 *
 * WHY THIS CRON EXISTS (the S1-3 finding): DELETE /account enqueues an
 * IMMEDIATE purge job, not a delayed one — it arrives ~30 days before
 * `deletionDueAt` and the processor correctly skips it as not-yet-due. Nothing
 * else would ever fire at the due date, so this sweep is the real trigger of
 * the 30-day path: it enqueues ONE sweep job per day; the PROCESSOR then finds
 * due accounts and enqueues per-user purge jobs.
 *
 * Per cron-queue-dedupe.md this handler does NOTHING but enqueue, with a
 * deterministic per-day jobId — exactly-once regardless of replica count.
 * (BullMQ v5 forbids ':' in custom jobIds — '-' separator.)
 */
@Injectable()
export class PurgeCron {
  private readonly logger = new Logger(PurgeCron.name);

  constructor(@InjectQueue(QUEUE_NAMES.ACCOUNT_PURGE) private readonly queue: Queue) {}

  @Cron('30 2 * * *')
  async schedulePurgeSweep(): Promise<void> {
    const day = new Date().toISOString().slice(0, 10); // e.g. 2026-07-14
    const jobId = `purge-sweep-${day}`;
    await this.queue.add(JOB_NAMES.PURGE_SWEEP, {}, { jobId });
    this.logger.log(`Enqueued purge sweep (jobId: ${jobId})`);
  }
}
