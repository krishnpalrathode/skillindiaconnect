import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Job as BullJob, Queue } from 'bullmq';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from '../../queue/queue.constants';
import { MAINTENANCE_WORKER_OPTS } from '../../queue/worker-tuning';
import {
  PurgeService,
  type PurgeCounts,
  type PurgeResult,
  type PurgeTrigger,
} from './purge.service';

/** Payload of a PURGE_CANDIDATE job. capturedKeys/counts are persisted by THIS processor. */
export interface PurgeJobData {
  userId: string;
  trigger?: PurgeTrigger;
  reason?: string;
  actorUserId?: string;
  actorRole?: string;
  /** Persisted into the job BEFORE the DB transaction — the retry's only copy. */
  capturedKeys?: string[];
  /** Persisted right after the DB commit — audit counts for a resumed run. */
  counts?: PurgeCounts;
}

/** Retry policy for per-user purge jobs enqueued by the sweep. */
export const PURGE_JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
} as const;

/**
 * THE purge worker (S6b-B1) — the consumer S1-3's enqueue has waited for.
 *
 * Two job names on the ACCOUNT_PURGE queue:
 *
 * PURGE_SWEEP (from PurgeCron, daily): finds candidates whose 30-day grace has
 * elapsed and enqueues one PURGE_CANDIDATE job each. The per-user jobId is
 * `purge-{userId}-due-{YYYY-MM-DD}` — NOT the prompt-obvious `purge-{userId}`,
 * for a load-bearing reason: S1-3's DELETE /account already enqueued an
 * IMMEDIATE `purge-{userId}` job which arrives ~30 days early and completes as
 * a skip; BullMQ's jobId dedupe would then swallow any later add with the SAME
 * id and the user would NEVER be purged. The per-day suffix sidesteps the
 * collision and doubles as a daily backstop: if a purge run exhausts its
 * retries, the next day's sweep re-enqueues under a fresh id.
 *
 * PURGE_CANDIDATE (from S1-3's request, the sweep, or the admin action): runs
 * PurgeService.purgeUser. Before the destructive transaction, the captured R2
 * keys are persisted INTO THE JOB DATA — after the transaction commits, the DB
 * no longer knows those keys, so the job payload is what makes a
 * commit-then-R2-crash resumable. Counts are persisted the same way for the
 * resumed run's audit row.
 *
 * (BullMQ v5 forbids ':' in custom jobIds — every id here uses '-'.)
 */
@Injectable()
// MAINTENANCE tier: fed by a 02:30 cron (and by DELETE /account, which is not
// time-critical — the grace window is 30 days). See queue/worker-tuning.ts.
@Processor(QUEUE_NAMES.ACCOUNT_PURGE, MAINTENANCE_WORKER_OPTS)
export class PurgeProcessor extends WorkerHost {
  private readonly logger = new Logger(PurgeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly purgeService: PurgeService,
    @InjectQueue(QUEUE_NAMES.ACCOUNT_PURGE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: BullJob): Promise<PurgeResult | { enqueued: number }> {
    switch (job.name) {
      case JOB_NAMES.PURGE_SWEEP:
        return this.sweep();
      case JOB_NAMES.PURGE_CANDIDATE:
        return this.purgeOne(job as BullJob<PurgeJobData>);
      default:
        this.logger.warn(`Unexpected job name "${job.name}" — skipping`);
        return { enqueued: 0 };
    }
  }

  /** Find every candidate whose grace window has elapsed; enqueue, never purge inline. */
  private async sweep(): Promise<{ enqueued: number }> {
    const due = await this.prisma.user.findMany({
      where: {
        role: UserRole.CANDIDATE,
        status: UserStatus.PENDING_DELETION,
        purgedAt: null,
        deletionDueAt: { not: null, lte: new Date() },
      },
      select: { id: true },
    });

    const day = new Date().toISOString().slice(0, 10);
    for (const user of due) {
      await this.queue.add(
        JOB_NAMES.PURGE_CANDIDATE,
        { userId: user.id, trigger: 'self' } satisfies PurgeJobData,
        { jobId: `purge-${user.id}-due-${day}`, ...PURGE_JOB_OPTS },
      );
    }
    this.logger.log(`purge sweep: ${due.length} account(s) due, enqueued`);
    return { enqueued: due.length };
  }

  private async purgeOne(job: BullJob<PurgeJobData>): Promise<PurgeResult> {
    const data = job.data;

    // Capture-then-persist BEFORE any destruction (see class docblock).
    let capturedKeys = data.capturedKeys;
    if (capturedKeys === undefined) {
      capturedKeys = await this.purgeService.captureObjectKeys(data.userId);
      await job.updateData({ ...data, capturedKeys });
    }

    const result = await this.purgeService.purgeUser({
      userId: data.userId,
      trigger: data.trigger ?? 'self',
      reason: data.reason,
      actorUserId: data.actorUserId,
      actorRole: data.actorRole,
      capturedKeys,
      priorCounts: data.counts ?? null,
      onDbCommitted: async (counts) => {
        await job.updateData({ ...data, capturedKeys, counts });
      },
    });

    // Outcome (an enum + the user id, no PII) — visible in the queue dashboard.
    this.logger.log(`purge ${data.userId}: ${result.outcome}`);
    return result;
  }
}
