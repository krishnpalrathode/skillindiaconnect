import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job as BullJob } from 'bullmq';
import { NotificationType, SubscriptionStatus, JobStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { EmployerService } from '../employer/employer.service';
import { JobLifecycleService } from '../jobs/job-lifecycle.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { MAINTENANCE_WORKER_OPTS } from '../queue/worker-tuning';
import {
  FREE_PLAN_CODE,
  SUBSCRIPTION_GRACE_DAYS,
  SUBSCRIPTION_LIFECYCLE_BATCH_SIZE,
  type RenewalReminderWindow,
} from './subscription-lifecycle.constants';

/** Per-run counts — audited as the sweep summary (ids/counts only, no PII). */
export interface LifecycleSweepCounts {
  graceStarted: number;
  reminder7: number;
  reminder1: number;
  expired: number;
  jobsPaused: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * The subscription expiry ladder (S5-B3), driven by the daily sweep job:
 *
 *  1. ACTIVE paid subs past `expiresAt` → GRACE (`graceEndsAt = expiresAt + 7d`).
 *  2. Pre-expiry reminders at T-7 and T-1 (SUBSCRIPTION_EXPIRING), deduped
 *     once-per-`{expiresAt, window}` via the notifications ledger (S3-B3's
 *     passport discipline verbatim) — a renewal's new expiresAt restarts the
 *     ladder correctly.
 *  3. GRACE past `graceEndsAt` → EXPIRED + the pause rule: all the company's
 *     ACTIVE jobs EXCEPT the most recently PUBLISHED one are paused.
 *
 * Notification mapping (matrix rows are seeded; both are in-app + email):
 *  - T-7 / T-1 reminders            → SUBSCRIPTION_EXPIRING
 *  - ACTIVE→GRACE (grace framing)   → SUBSCRIPTION_EXPIRED ("7 days to renew,
 *    your jobs stay live") — the term HAS expired; EXPIRING stays pre-expiry.
 *  - GRACE→EXPIRED (downgrade)      → SUBSCRIPTION_EXPIRED ("now on the Free
 *    plan — {n} jobs paused").
 *
 * Idempotency: transitions are guarded by status (a GRACE row is never
 * re-graced), reminders by the ledger — re-running the day's job is a no-op.
 */
@Injectable()
// MAINTENANCE tier: fed by a 03:00 cron. See queue/worker-tuning.ts.
@Processor(QUEUE_NAMES.SUBSCRIPTION_LIFECYCLE, MAINTENANCE_WORKER_OPTS)
export class SubscriptionLifecycleProcessor extends WorkerHost {
  private readonly logger = new Logger(SubscriptionLifecycleProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly auditService: AuditService,
    private readonly employerService: EmployerService,
    private readonly jobLifecycleService: JobLifecycleService,
  ) {
    super();
  }

  async process(job: BullJob): Promise<LifecycleSweepCounts> {
    if (job.name !== JOB_NAMES.SUBSCRIPTION_LIFECYCLE_SWEEP) {
      this.logger.warn(`Unexpected job name "${job.name}" — skipping`);
      return { graceStarted: 0, reminder7: 0, reminder1: 0, expired: 0, jobsPaused: 0 };
    }

    this.logger.log(`Subscription-lifecycle sweep started (jobId: ${job.id})`);
    const now = new Date();

    const graceStarted = await this.transitionActiveToGrace(now);
    const reminder7 = await this.sendReminders(7, now);
    const reminder1 = await this.sendReminders(1, now);
    const { expired, jobsPaused } = await this.transitionGraceToExpired(now);

    const counts: LifecycleSweepCounts = {
      graceStarted,
      reminder7,
      reminder1,
      expired,
      jobsPaused,
    };
    this.logger.log(`Subscription-lifecycle sweep done: ${JSON.stringify(counts)}`);

    await this.auditService.log({
      action: AUDIT_ACTIONS.SUBSCRIPTION_LIFECYCLE_RUN,
      module: AUDIT_MODULES.PAYMENTS,
      status: AuditStatus.SUCCESS,
      meta: { ...counts },
    });

    return counts;
  }

  // ── Step 1: ACTIVE past expiresAt → GRACE ──────────────────────────────────

  private async transitionActiveToGrace(now: Date): Promise<number> {
    let transitioned = 0;

    while (true) {
      // Each transition removes the row from this filter, so plain
      // re-querying pages naturally.
      const batch = await this.prisma.subscription.findMany({
        where: {
          status: SubscriptionStatus.ACTIVE,
          expiresAt: { not: null, lte: now },
          plan: { code: { not: FREE_PLAN_CODE } },
        },
        take: SUBSCRIPTION_LIFECYCLE_BATCH_SIZE,
        include: { plan: true },
      });
      if (batch.length === 0) break;

      for (const sub of batch) {
        const graceEndsAt = addDays(sub.expiresAt!, SUBSCRIPTION_GRACE_DAYS);
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { status: SubscriptionStatus.GRACE, graceEndsAt },
        });

        await this.auditService.log({
          actorRole: UserRole.SUPER_ADMIN, // system actor — lifecycle-driven
          action: AUDIT_ACTIONS.SUBSCRIPTION_GRACE_STARTED,
          module: AUDIT_MODULES.PAYMENTS,
          targetType: 'Subscription',
          targetId: sub.id,
          status: AuditStatus.SUCCESS,
          meta: {
            companyId: sub.companyId,
            planCode: sub.plan.code,
            expiresAt: sub.expiresAt!.toISOString(),
            graceEndsAt: graceEndsAt.toISOString(),
          },
        });

        await this.notifyCompany(sub.companyId, NotificationType.SUBSCRIPTION_EXPIRED, {
          title: 'Subscription expired — 7 days to renew',
          body:
            `Your ${sub.plan.name} plan has expired. You have ` +
            `${SUBSCRIPTION_GRACE_DAYS} days to renew — your jobs stay live until ` +
            `${graceEndsAt.toISOString().slice(0, 10)}.`,
          data: {
            phase: 'GRACE',
            expiresAt: sub.expiresAt!.toISOString(),
            graceEndsAt: graceEndsAt.toISOString(),
          },
        });

        transitioned++;
      }
    }

    return transitioned;
  }

  // ── Step 2: T-7 / T-1 reminders (ledger-deduped) ───────────────────────────

  private async sendReminders(window: RenewalReminderWindow, now: Date): Promise<number> {
    // Non-overlapping bands: window 7 covers (now+1d, now+7d], window 1
    // covers (now, now+1d] — a sub late-entering a band still gets that
    // band's reminder once (the ledger, not the band edges, dedupes).
    const band =
      window === 7
        ? { gt: addDays(now, 1), lte: addDays(now, 7) }
        : { gt: now, lte: addDays(now, 1) };

    let sent = 0;
    let cursor: string | undefined;

    while (true) {
      const batch = await this.prisma.subscription.findMany({
        where: {
          status: SubscriptionStatus.ACTIVE,
          renewalReminders: true,
          expiresAt: band,
          plan: { code: { not: FREE_PLAN_CODE } },
        },
        orderBy: { id: 'asc' },
        take: SUBSCRIPTION_LIFECYCLE_BATCH_SIZE,
        ...(cursor && { skip: 1, cursor: { id: cursor } }),
        include: { plan: true },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.id;

      for (const sub of batch) {
        const userId = await this.employerService.getPrimaryUserIdForCompany(sub.companyId);
        if (!userId) continue;

        const expiresAtIso = sub.expiresAt!.toISOString();
        if (await this.isReminderDuplicate(userId, expiresAtIso, window)) continue;

        const daysLeft = Math.max(
          1,
          Math.ceil((sub.expiresAt!.getTime() - now.getTime()) / DAY_MS),
        );
        await this.notificationService.notify(userId, NotificationType.SUBSCRIPTION_EXPIRING, {
          title: 'Subscription expiring soon',
          body:
            `Your ${sub.plan.name} plan expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} ` +
            `(on ${expiresAtIso.slice(0, 10)}). Renew to keep your jobs live.`,
          data: { expiresAt: expiresAtIso, window },
        });

        sent++;
      }

      if (batch.length < SUBSCRIPTION_LIFECYCLE_BATCH_SIZE) break;
    }

    return sent;
  }

  /**
   * The once-per-window ledger gate, keyed `{expiresAt, window}` — S3-B3's
   * passport key discipline verbatim. A renewed subscription carries a NEW
   * expiresAt, so its reminder ladder restarts; re-running the day's sweep
   * finds the row and no-ops.
   *
   * Prisma cannot AND two JSON-path conditions in one `where`, hence $queryRaw.
   */
  private async isReminderDuplicate(
    userId: string,
    expiresAtIso: string,
    window: RenewalReminderWindow,
  ): Promise<boolean> {
    const result = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM notifications
      WHERE "userId"      = ${userId}
        AND type          = 'SUBSCRIPTION_EXPIRING'
        AND data->>'expiresAt' = ${expiresAtIso}
        AND (data->>'window')::int = ${window}
    `;
    return (result[0]?.count ?? 0) > 0;
  }

  // ── Step 3: GRACE past graceEndsAt → EXPIRED + the pause rule ──────────────

  private async transitionGraceToExpired(
    now: Date,
  ): Promise<{ expired: number; jobsPaused: number }> {
    let expired = 0;
    let jobsPaused = 0;

    while (true) {
      const batch = await this.prisma.subscription.findMany({
        where: {
          status: SubscriptionStatus.GRACE,
          graceEndsAt: { not: null, lte: now },
          plan: { code: { not: FREE_PLAN_CODE } },
        },
        take: SUBSCRIPTION_LIFECYCLE_BATCH_SIZE,
        include: { plan: true },
      });
      if (batch.length === 0) break;

      for (const sub of batch) {
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { status: SubscriptionStatus.EXPIRED },
        });

        const paused = await this.pauseAllButMostRecent(sub.companyId);
        jobsPaused += paused;

        await this.auditService.log({
          actorRole: UserRole.SUPER_ADMIN, // system actor — lifecycle-driven
          action: AUDIT_ACTIONS.SUBSCRIPTION_EXPIRED,
          module: AUDIT_MODULES.PAYMENTS,
          targetType: 'Subscription',
          targetId: sub.id,
          status: AuditStatus.SUCCESS,
          meta: { companyId: sub.companyId, planCode: sub.plan.code, jobsPaused: paused },
        });

        // Renewal ≠ resume: jobs paused here STAY paused after a renewal
        // (the suspend-cascade precedent) — the copy says so.
        await this.notifyCompany(sub.companyId, NotificationType.SUBSCRIPTION_EXPIRED, {
          title: 'Subscription ended — account on the Free plan',
          body:
            `Your grace period has ended and your account is now on the Free plan — ` +
            `${paused} job${paused === 1 ? '' : 's'} paused. Renewing will not resume ` +
            `paused jobs automatically; resume them from My Jobs after renewing.`,
          data: { phase: 'EXPIRED', jobsPaused: paused },
        });

        expired++;
      }
    }

    return { expired, jobsPaused };
  }

  /**
   * The pause rule: keep ONLY the most recently PUBLISHED active job live
   * (`publishedAt`, not `createdAt` — a re-published old draft counts as
   * recent); pause the rest through JobLifecycleService so each pause is
   * audited and emits job.paused (search-cache invalidation rides that
   * event). Zero or one active job → nothing pauses.
   *
   * Paused jobs are NOT auto-resumed on renewal — manual resume only, the
   * suspend-cascade precedent.
   */
  private async pauseAllButMostRecent(companyId: string): Promise<number> {
    const activeJobs = await this.prisma.job.findMany({
      where: { companyId, status: JobStatus.ACTIVE },
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      select: { id: true },
    });
    if (activeJobs.length <= 1) return 0;

    let paused = 0;
    for (const job of activeJobs.slice(1)) {
      await this.jobLifecycleService.pause(
        job.id,
        companyId,
        undefined, // system action — no acting user
        UserRole.SUPER_ADMIN,
        'subscription_expired',
      );
      paused++;
    }
    return paused;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async notifyCompany(
    companyId: string,
    type: NotificationType,
    payload: { title: string; body: string; data: Record<string, unknown> },
  ): Promise<void> {
    try {
      const userId = await this.employerService.getPrimaryUserIdForCompany(companyId);
      if (userId) await this.notificationService.notify(userId, type, payload);
    } catch (err) {
      // A notification hiccup never rolls back a lifecycle transition.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`lifecycle notification failed for company ${companyId}: ${msg}`);
    }
  }
}
