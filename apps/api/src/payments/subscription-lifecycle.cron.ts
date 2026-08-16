import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

/**
 * Subscription-lifecycle cron — fires daily at 03:00 UTC (passport runs at
 * 01:00, auto-archive at 02:00; staggered so the worker never stacks sweeps).
 *
 * Per cron-queue-dedupe.md (third consumer of the pattern): does NOTHING but
 * enqueue a BullMQ job with a deterministic jobId derived from the calendar
 * day. BullMQ's jobId dedupe guarantees exactly-once execution regardless of
 * worker replica count. The ladder itself (reminders, ACTIVE→GRACE→EXPIRED,
 * the pause rule) runs in SubscriptionLifecycleProcessor.
 */
@Injectable()
export class SubscriptionLifecycleCron {
  private readonly logger = new Logger(SubscriptionLifecycleCron.name);

  constructor(@InjectQueue(QUEUE_NAMES.SUBSCRIPTION_LIFECYCLE) private readonly queue: Queue) {}

  @Cron('0 3 * * *')
  async scheduleSubscriptionLifecycleSweep(): Promise<void> {
    const day = new Date().toISOString().slice(0, 10); // e.g. 2026-07-11
    // BullMQ (v5) forbids ':' in custom job IDs (the internal Redis key
    // separator) — a colon throws and the sweep is NEVER enqueued. Use '-'.
    const jobId = `subscription-lifecycle-${day}`;
    await this.queue.add(JOB_NAMES.SUBSCRIPTION_LIFECYCLE_SWEEP, {}, { jobId });
    this.logger.log(`Enqueued subscription-lifecycle sweep (jobId: ${jobId})`);
  }
}
