import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

/**
 * Passport-expiry cron — fires daily at 01:00 UTC.
 *
 * Per cron-queue-dedupe.md: does NOTHING but enqueue a BullMQ job with a
 * deterministic jobId derived from the calendar day. BullMQ's jobId dedupe
 * guarantees exactly-once execution regardless of replica count.
 *
 * The actual passport scan and notification fan-out happen in PassportExpiryProcessor.
 */
@Injectable()
export class PassportExpiryCron {
  private readonly logger = new Logger(PassportExpiryCron.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.PASSPORT_EXPIRY) private readonly queue: Queue,
  ) {}

  @Cron('0 1 * * *')
  async schedulePassportExpiryReminders(): Promise<void> {
    const day = new Date().toISOString().slice(0, 10); // e.g. 2026-07-04
    // BullMQ (v5) forbids ':' in custom job IDs (it is the internal Redis key
    // separator) — a colon throws and the scan is NEVER enqueued. Use '-'.
    const jobId = `passport-expiry-${day}`;
    await this.queue.add(JOB_NAMES.PASSPORT_EXPIRY_SCAN, {}, { jobId });
    this.logger.log(`Enqueued passport-expiry scan (jobId: ${jobId})`);
  }
}
