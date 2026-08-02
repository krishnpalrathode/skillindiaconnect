import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from './queue.constants';

/**
 * Retention caps for finished jobs.
 *
 * BullMQ's documented default is to keep completed AND failed jobs FOREVER
 * ("Default behavior is to keep the job in the completed set"). Every job this
 * platform has ever run was still resident in Redis. On a 256MB plan that is a
 * wall you hit silently, and the failure mode — writes rejected once the
 * instance is full — looks nothing like its cause.
 *
 * The ages are chosen against how these sets are actually used:
 *   completed — 24h, enough to confirm "did last night's cron run?", which is
 *               the only question anyone asks of it. The `count` cap is the
 *               backstop for a burst that would otherwise blow the budget
 *               inside the age window.
 *   failed    — 7d, because a failure is evidence and someone has to be able to
 *               look at it on Monday. This is the set worth paying to keep.
 *
 * Deliberately NOT shorter than a day: BullMQ's jobId dedupe (cron-queue-dedupe.md)
 * consults the completed set, so evicting it faster than the dedupe window would
 * let a same-window job run twice. Every deterministic jobId here is scoped to a
 * calendar day, so 24h is the floor.
 */
const FINISHED_JOB_RETENTION = {
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
} as const;

/**
 * Producer-only queue registration. Processors (consumers) are added by each
 * worker unit when it is built — this module registers the queues so the API
 * can call queue.add() without running any BullMQ workers.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
           url: config.get<string>('REDIS_URL'),
           maxRetriesPerRequest: null,
        },
        // Per-call opts (attempts, backoff, jobId) merge OVER these — every
        // existing producer keeps its own retry policy unchanged.
        defaultJobOptions: { ...FINISHED_JOB_RETENTION },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.ACCOUNT_PURGE },
      { name: QUEUE_NAMES.R2_DELETE },
      { name: QUEUE_NAMES.NOTIFICATION },
      { name: QUEUE_NAMES.AUTO_ARCHIVE },
      { name: QUEUE_NAMES.PASSPORT_EXPIRY },
      { name: QUEUE_NAMES.SUBSCRIPTION_LIFECYCLE },
      // S7-B1: Puppeteer renders — the API only ever enqueues onto these.
      { name: QUEUE_NAMES.RESUME_RENDER },
      { name: QUEUE_NAMES.INVOICE_RENDER },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
