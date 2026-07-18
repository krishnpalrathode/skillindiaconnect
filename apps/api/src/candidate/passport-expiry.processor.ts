import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job as BullJob } from 'bullmq';
import { DocumentType, NotificationType, UserStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import {
  REMINDER_WINDOWS,
  PASSPORT_EXPIRY_BATCH_SIZE,
  type ReminderWindow,
} from './passport-expiry.constants';

/** Counts of notifications sent per window in a single run. */
export interface WindowCounts {
  window60?: number;
  window30?: number;
  window7?: number;
  window0?: number;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Returns the Prisma DateTimeNullableFilter for passports in this window's expiry band. */
function windowFilter(window: ReminderWindow, now: Date) {
  switch (window) {
    case 60:
      return { gt: addDays(now, 30), lte: addDays(now, 60) };
    case 30:
      return { gt: addDays(now, 7), lte: addDays(now, 30) };
    case 7:
      return { gt: now, lte: addDays(now, 7) };
    case 0:
      return { lte: now };
  }
}

function daysUntilExpiry(expiryDate: Date, now: Date): number {
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const expiryMs = new Date(
    expiryDate.getFullYear(),
    expiryDate.getMonth(),
    expiryDate.getDate(),
  ).getTime();
  return Math.round((expiryMs - todayMs) / 86_400_000);
}

@Injectable()
@Processor(QUEUE_NAMES.PASSPORT_EXPIRY)
export class PassportExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(PassportExpiryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly auditService: AuditService,
  ) {
    super();
  }

  async process(job: BullJob): Promise<WindowCounts> {
    if (job.name !== JOB_NAMES.PASSPORT_EXPIRY_SCAN) {
      this.logger.warn(`Unexpected job name "${job.name}" — skipping`);
      return {};
    }

    this.logger.log(`Passport-expiry scan started (jobId: ${job.id})`);
    const now = new Date();
    const counts: WindowCounts = {};

    for (const window of REMINDER_WINDOWS) {
      const sent = await this.processWindow(window, now);
      counts[`window${window}` as keyof WindowCounts] = sent;
    }

    this.logger.log(`Passport-expiry scan done: ${JSON.stringify(counts)}`);

    // Counts only — no PII in audit meta.
    await this.auditService.log({
      action: AUDIT_ACTIONS.PASSPORT_EXPIRY_RUN,
      module: AUDIT_MODULES.CANDIDATE,
      status: AuditStatus.SUCCESS,
      meta: {
        window60: counts.window60 ?? 0,
        window30: counts.window30 ?? 0,
        window7: counts.window7 ?? 0,
        window0: counts.window0 ?? 0,
      },
    });

    return counts;
  }

  private async processWindow(window: ReminderWindow, now: Date): Promise<number> {
    const filter = windowFilter(window, now);
    let notified = 0;
    let cursor: string | undefined;

    while (true) {
      const batch = await this.prisma.candidateDocument.findMany({
        where: {
          type: DocumentType.PASSPORT,
          expiryDate: filter,
          candidate: {
            user: { status: { not: UserStatus.PENDING_DELETION } },
          },
        },
        orderBy: { id: 'asc' },
        take: PASSPORT_EXPIRY_BATCH_SIZE,
        ...(cursor && { skip: 1, cursor: { id: cursor } }),
        select: {
          id: true,
          expiryDate: true,
          candidate: {
            select: { userId: true },
          },
        },
      });

      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.id;

      for (const doc of batch) {
        const expiryDate = doc.expiryDate!;
        const { userId } = doc.candidate;
        const expiryDateStr = expiryDate.toISOString().slice(0, 10);

        if (await this.isDuplicate(userId, expiryDateStr, window)) continue;

        const daysRemaining = daysUntilExpiry(expiryDate, now);
        await this.notificationService.notify(
          userId,
          NotificationType.PASSPORT_EXPIRY,
          {
            title: 'Passport Expiry Reminder',
            body:
              daysRemaining <= 0
                ? 'Your passport has expired. Please renew it to stay eligible for applications.'
                : `Your passport expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}. Please renew it soon.`,
            data: { expiryDate: expiryDateStr, daysRemaining, window },
          },
        );

        notified++;
      }

      if (batch.length < PASSPORT_EXPIRY_BATCH_SIZE) break;
    }

    return notified;
  }

  /**
   * Checks whether a PASSPORT_EXPIRY notification for this exact (userId, expiryDate, window)
   * combination has already been delivered. This is the once-per-window dedup gate.
   *
   * Prisma cannot AND two separate JSON-path conditions in a single `where` clause, so we
   * use $queryRaw for the compound filter on the `data` JSONB column.
   */
  private async isDuplicate(
    userId: string,
    expiryDateStr: string,
    window: ReminderWindow,
  ): Promise<boolean> {
    const result = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM notifications
      WHERE "userId"      = ${userId}
        AND type          = 'PASSPORT_EXPIRY'
        AND data->>'expiryDate' = ${expiryDateStr}
        AND (data->>'window')::int = ${window}
    `;
    return (result[0]?.count ?? 0) > 0;
  }
}
