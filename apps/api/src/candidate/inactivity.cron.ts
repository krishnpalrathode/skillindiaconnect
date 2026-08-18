import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

/**
 * Inactivity check-in cron — fires daily at 03:00 UTC.
 *
 * Per cron-queue-dedupe.md this does NOTHING but enqueue, with a jobId derived
 * from the calendar day so BullMQ collapses duplicate fires across replicas.
 * Without that, a second worker replica would email every lapsed candidate
 * twice — the exact failure this rule exists to prevent, and one the recipient
 * would notice.
 *
 * 03:00 rather than 01:00 keeps it clear of the passport-expiry scan, so two
 * batch scans are not competing for the same connection pool at the same time.
 *
 * The scan itself lives in InactivityProcessor.
 */
@Injectable()
export class InactivityCron {
  private readonly logger = new Logger(InactivityCron.name);

  constructor(@InjectQueue(QUEUE_NAMES.CANDIDATE_INACTIVITY) private readonly queue: Queue) {}

  @Cron('0 3 * * *')
  async scheduleInactivityScan(): Promise<void> {
    const day = new Date().toISOString().slice(0, 10); // e.g. 2026-08-18
    // HYPHEN, never a colon: BullMQ 5 rejects a custom jobId containing ':' at
    // runtime, and the scan would never be enqueued at all.
    const jobId = `inactivity-scan-${day}`;
    await this.queue.add(JOB_NAMES.INACTIVITY_SCAN, {}, { jobId });
    this.logger.log(`Enqueued inactivity scan (jobId: ${jobId})`);
  }
}
