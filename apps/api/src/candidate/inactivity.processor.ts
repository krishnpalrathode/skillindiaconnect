import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job as BullJob } from 'bullmq';
import { NotificationType, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { MAINTENANCE_WORKER_OPTS } from '../queue/worker-tuning';
import { INACTIVITY_NUDGE_DAYS } from './activity.constants';

/** Rows per page. Bounded so a large lapsed cohort cannot load in one go. */
export const INACTIVITY_BATCH_SIZE = 200;

export interface InactivityScanResult {
  scanned: number;
  notified: number;
}

/**
 * "Are you still looking?" — the 30-day inactivity check-in.
 *
 * ── The send-once guard, and why there is no column for it ─────────────────
 * A candidate must get ONE email per spell of inactivity, not one per day for
 * the rest of time. The obvious implementation is a `lastNudgedAt` column, but
 * it needs resetting when they come back, and the reset would have to happen in
 * the AUTH module — which does not own `candidate_profiles`.
 *
 * So the guard is the notifications table instead: skip anyone who already has
 * a CANDIDATE_INACTIVE_CHECK_IN dated AFTER their `lastLoginAt`. Signing in
 * moves `lastLoginAt` past every previous nudge, which re-arms the check
 * automatically — no reset, no column, no cross-module write, and no way for
 * the flag and the fact to disagree.
 *
 * ── Who is deliberately excluded ──────────────────────────────────────────
 * Only ACTIVE candidate accounts. Suspended and pending-deletion users are not
 * people we should be inviting back, and an anonymised purge tombstone has no
 * inbox worth writing to.
 */
@Injectable()
// MAINTENANCE tier: fed by a 03:00 cron, never by user traffic.
@Processor(QUEUE_NAMES.CANDIDATE_INACTIVITY, MAINTENANCE_WORKER_OPTS)
export class InactivityProcessor extends WorkerHost {
  private readonly logger = new Logger(InactivityProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {
    super();
  }

  async process(_job: BullJob): Promise<InactivityScanResult> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - INACTIVITY_NUDGE_DAYS * 24 * 60 * 60 * 1000);

    let scanned = 0;
    let notified = 0;
    let cursor: string | undefined;

    // Keyset pagination on id: an offset scan would drift as rows change under
    // it, and this loop can run for a while on a large cohort.
    for (;;) {
      const batch = await this.prisma.user.findMany({
        where: {
          role: UserRole.CANDIDATE,
          status: UserStatus.ACTIVE,
          /*
            `null` is INCLUDED via the OR: somebody who registered and never
            signed in again is precisely the person worth asking, and a bare
            `lt: cutoff` would silently skip every one of them because SQL
            comparisons against NULL are never true.
          */
          OR: [{ lastLoginAt: { lt: cutoff } }, { lastLoginAt: null }],
        },
        select: { id: true, lastLoginAt: true, createdAt: true },
        orderBy: { id: 'asc' },
        take: INACTIVITY_BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.id;

      for (const user of batch) {
        scanned += 1;

        /*
          A brand-new account is not an inactive one.

          Without this, somebody who signs up and never logs in a second time
          gets the "are you still looking?" email on day 30 of their ACCOUNT
          even if they were browsing yesterday on the session they signed up
          with. Falling back to createdAt gives them the same 30-day grace the
          rest of the rule assumes.
        */
        const lastSeen = user.lastLoginAt ?? user.createdAt;
        if (lastSeen >= cutoff) continue;

        // The guard: already asked since they were last seen?
        const alreadyAsked = await this.prisma.notification.count({
          where: {
            userId: user.id,
            type: NotificationType.CANDIDATE_INACTIVE_CHECK_IN,
            createdAt: { gt: lastSeen },
          },
        });
        if (alreadyAsked > 0) continue;

        try {
          await this.notificationService.notify(
            user.id,
            NotificationType.CANDIDATE_INACTIVE_CHECK_IN,
            {
              title: 'Are you still looking for work?',
              body: 'Sign in to keep your profile active so employers can find you.',
              data: { inactiveDays: INACTIVITY_NUDGE_DAYS },
            },
          );
          notified += 1;
        } catch (err) {
          // One bad recipient must not abort the sweep for everyone behind
          // them in the batch.
          this.logger.error(
            `inactivity check-in failed for user ${user.id}`,
            err instanceof Error ? err.stack : undefined,
          );
        }
      }

      if (batch.length < INACTIVITY_BATCH_SIZE) break;
    }

    this.logger.log(`inactivity scan complete — scanned ${scanned}, notified ${notified}`);
    return { scanned, notified };
  }
}
