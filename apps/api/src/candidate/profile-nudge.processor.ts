import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job as BullJob } from 'bullmq';
import { NotificationType, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { WA_TEMPLATE_VARS_KEY } from '../notifications/notification.types';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { MAINTENANCE_WORKER_OPTS } from '../queue/worker-tuning';
import { CompletionService } from './completion/completion.service';
import {
  PROFILE_NUDGE_BATCH_SIZE,
  PROFILE_NUDGE_DELAY_HOURS,
  PROFILE_NUDGE_MAX_AGE_DAYS,
} from './profile-nudge.constants';

export interface ProfileNudgeScanResult {
  scanned: number;
  notified: number;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * "Finish your profile so you can apply" — sent ONCE, 24 hours after a
 * candidate registers, if they are still below the apply threshold.
 *
 * ── The threshold is READ, never hardcoded ────────────────────────────────
 * `candidates.min_completion_pct` (70 today) is the same setting the apply gate
 * enforces and the same one the in-app "you can now apply" dialog watches. A
 * literal 70 here would start lying the day an admin moves it — and it would
 * lie in a WhatsApp message, which cannot be edited or unsent once delivered.
 * The number the candidate is told to reach is therefore passed as a template
 * parameter, not baked into the approved copy.
 *
 * ── The send-once guard, and why there is no column ───────────────────────
 * "Only once" is absolute here: not once per spell, once ever. The guard is the
 * notifications table — skip anyone who already has a PROFILE_REMINDER row.
 * That is the same technique `maybeNotifyProfileComplete` and the passport
 * sweep use, and it means the flag and the fact cannot disagree, because the
 * feed row IS the record that we messaged them.
 *
 * PROFILE_REMINDER already existed in the matrix with email copy and NO
 * producer — nothing in the system ever sent one. So the type is claimed here
 * rather than a new enum value being added, which would have needed a
 * migration to say something the schema could already express.
 *
 * ── Who is deliberately excluded ──────────────────────────────────────────
 * Only ACTIVE candidates. A suspended account cannot apply for anything, so
 * urging it to finish a profile is a message with no honest ending; a
 * pending-deletion or purged account has no inbox worth writing to.
 *
 * A candidate with no verified phone is skipped by the CHANNEL, not here: the
 * matrix falls back to email when `whatsappCapable` is false, so they still
 * hear about it — just by the route that can reach them.
 */
@Injectable()
// MAINTENANCE tier: fed by an hourly cron, never by user traffic.
@Processor(QUEUE_NAMES.PROFILE_NUDGE, MAINTENANCE_WORKER_OPTS)
export class ProfileNudgeProcessor extends WorkerHost {
  private readonly logger = new Logger(ProfileNudgeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly completion: CompletionService,
  ) {
    super();
  }

  async process(_job: BullJob): Promise<ProfileNudgeScanResult> {
    const threshold = await this.completion.getMinCompletionPct();
    const now = Date.now();
    const readyAt = new Date(now - PROFILE_NUDGE_DELAY_HOURS * HOUR_MS);
    const floor = new Date(now - PROFILE_NUDGE_MAX_AGE_DAYS * 24 * HOUR_MS);

    let scanned = 0;
    let notified = 0;
    let cursor: string | undefined;

    for (;;) {
      /*
        The whole eligibility rule lives in this WHERE clause so the database
        does the narrowing. Filtering in JavaScript would drag every profile in
        the window across the wire once an hour to discard most of them.

        `completionPct` is indexed, and the createdAt window is a narrow slice,
        so this stays cheap as the table grows.
      */
      const batch = await this.prisma.candidateProfile.findMany({
        where: {
          completionPct: { lt: threshold },
          createdAt: { lte: readyAt, gte: floor },
          user: {
            role: UserRole.CANDIDATE,
            status: UserStatus.ACTIVE,
            /*
              ONCE, EVER — expressed as a NOT EXISTS against the feed row the
              send itself writes. Doing it in SQL rather than re-checking per
              row means an already-nudged candidate is never fetched at all,
              which turns what would be one COUNT query per profile into none.
            */
            notifications: { none: { type: NotificationType.PROFILE_REMINDER } },
          },
        },
        select: {
          id: true,
          userId: true,
          fullName: true,
          completionPct: true,
        },
        orderBy: { id: 'asc' },
        take: PROFILE_NUDGE_BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.id;

      for (const profile of batch) {
        scanned += 1;

        try {
          await this.notificationService.notify(profile.userId, NotificationType.PROFILE_REMINDER, {
            title: 'Finish your profile to start applying',
            body: `Your profile is ${profile.completionPct}% complete. Reach ${threshold}% to unlock job applications.`,
            data: {
              completionPct: profile.completionPct,
              requiredPct: threshold,
              /*
                  The approved Meta template's three body parameters, in order:
                  {{1}} first name · {{2}} current % · {{3}} required %.

                  Supplied HERE because the notification module deliberately
                  does not know what a completion percentage is — the raising
                  module holds the data and passes it in (CR-WA W0). Absent or
                  malformed vars fail the send rather than delivering a message
                  with holes in it.
                */
              [WA_TEMPLATE_VARS_KEY]: [
                firstName(profile.fullName),
                String(profile.completionPct),
                String(threshold),
              ],
            },
          });
          notified += 1;
        } catch (err) {
          // One bad recipient must not abort the sweep for everyone behind them.
          this.logger.error(
            `profile nudge failed for user ${profile.userId}`,
            err instanceof Error ? err.stack : undefined,
          );
        }
      }

      if (batch.length < PROFILE_NUDGE_BATCH_SIZE) break;
    }

    this.logger.log(
      `profile nudge scan complete — threshold ${threshold}%, scanned ${scanned}, notified ${notified}`,
    );
    return { scanned, notified };
  }
}

/**
 * First name only, for the greeting.
 *
 * "Hi Suresh" reads like a person wrote it; "Hi Suresh Kumar Yadav" reads like
 * a mail merge, which is exactly the impression a nudge cannot afford. Falls
 * back to the whole string when there is no space to split on, and never to an
 * empty greeting.
 */
export function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0]!;
}
