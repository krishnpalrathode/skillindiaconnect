import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { DeliveryStatus, NotificationType, Prisma, UserRole } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../core/prisma/prisma.service';
import { pageMeta, resolvePaging, type Paginated } from '../core/pagination';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { NOTIFICATION_MATRIX } from './notification.matrix';
import {
  NotifyPayload,
  NotificationJobData,
  NOTIFICATION_JOB_ATTEMPTS,
  NOTIFICATION_JOB_BACKOFF_MS,
  readTemplateVars,
} from './notification.types';
import { ListNotificationsDto, FILTER_BUCKETS } from './dto/list-notifications.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { NotificationDto, toNotificationDto } from './notification.mapper';
import { isWhatsappDeliverable } from './whatsapp-deliverability';

export interface NotifyOptions {
  /** Skip the WhatsApp channel even when the type's matrix row enables it. */
  suppressWhatsapp?: boolean;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION) private readonly notificationQueue: Queue,
  ) {}

  /**
   * Fan-out entry point.
   *
   * 1. In-app: if matrix.inApp → INSERT notifications row synchronously (instant feed).
   * 2. WhatsApp: if matrix.whatsapp → enqueue a 'whatsapp' job (worker sends externally).
   * 3. Email: if matrix.email → enqueue an 'email' job (worker sends externally).
   *
   * The API NEVER calls WhatsApp/SES channels directly — worker-and-external-sends.md.
   */
  async notify(
    userId: string,
    type: NotificationType,
    payload: NotifyPayload,
    opts?: NotifyOptions,
  ): Promise<void> {
    const entry = NOTIFICATION_MATRIX[type];

    /**
     * CR-WA W0 — the guard against forgetting.
     *
     * A whatsapp-tier type needs its template parameters, and they are supplied
     * by the RAISING module (see notification.types.ts). Nothing structural can
     * enforce that: startup validation cannot see call sites, and a compile-time
     * check does not bite because callers pass an already-widened
     * NotificationType rather than a literal.
     *
     * So it is caught HERE, at the enqueue, where the omission was made — the
     * worker would otherwise report it minutes later from a different process.
     *
     * LOGGED, NOT THROWN, on purpose: callers like StatusService.dispatchPostCommit
     * wrap notify() in a best-effort try/catch, so a throw would be swallowed and
     * would turn "degrades to email" into "the candidate hears nothing". The
     * worker still marks the row FAILED and falls back to email; this only makes
     * the cause visible at its source.
     */
    if (entry.whatsapp && !opts?.suppressWhatsapp && readTemplateVars(payload.data) === null) {
      this.logger.error(
        `notify(${type}) is a WhatsApp-tier type but carries no templateVars — ` +
          'the WhatsApp send will FAIL and fall back to email. The module raising ' +
          'this notification must supply them (see notification.types.ts).',
      );
    }

    // In-app is synchronous — written before we return so the feed is instantly updated.
    if (entry.inApp) {
      await this.prisma.notification.create({
        data: {
          userId,
          type,
          title: payload.title,
          body: payload.body,
          data: (payload.data as Prisma.InputJsonValue) ?? {},
        },
      });
    }

    const jobBase: Omit<NotificationJobData, 'channel'> = { userId, type, payload };
    const jobOpts = {
      attempts: NOTIFICATION_JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: NOTIFICATION_JOB_BACKOFF_MS },
    };

    // `suppressWhatsapp` lets a matrix-WhatsApp type (e.g. APPLICATION_SELECTED)
    // fan out to email + in-app ONLY. Used by the S4-B2 one-WhatsApp guard on a
    // SELECTED re-entry — the WhatsApp already fired on the first entry.
    if (entry.whatsapp && !opts?.suppressWhatsapp) {
      await this.notificationQueue.add(
        JOB_NAMES.SEND_NOTIFICATION,
        { ...jobBase, channel: 'whatsapp' } satisfies NotificationJobData,
        jobOpts,
      );
    }

    if (entry.email) {
      await this.notificationQueue.add(
        JOB_NAMES.SEND_NOTIFICATION,
        { ...jobBase, channel: 'email' } satisfies NotificationJobData,
        jobOpts,
      );
    }
  }

  /**
   * In-app-ONLY send (S4-B1). Writes the `notifications` row synchronously and
   * enqueues NOTHING — no WhatsApp, no email — regardless of the type's matrix
   * entry. Use for intra-app receipts that must never fan out externally, e.g.
   * the apply-side receipts (candidate "application submitted" + employer "new
   * applicant"). SELECTED's WhatsApp fireworks are a separate, guarded send (B2)
   * and go through notify(), not this method.
   *
   * The Applications module owns no notifications rows — it calls this seam so the
   * Notifications module remains the sole writer of that table (Rule 4).
   */
  async notifyInApp(userId: string, type: NotificationType, payload: NotifyPayload): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId,
        type,
        title: payload.title,
        body: payload.body,
        data: (payload.data as Prisma.InputJsonValue) ?? {},
      },
    });
  }

  /**
   * Enqueue an EMAIL for a channel the CALLER chose explicitly — not a matrix
   * fan-out (S7-B2 "email my resume to myself"). The matrix answers "which
   * channels does this EVENT use"; a candidate tapping "Email it to me" has
   * already answered that question, so no matrix row governs it.
   *
   * The in-app receipt is written too, so the send is visible in the feed.
   * The worker consumes the same job the matrix path produces — one send path.
   */
  async enqueueEmail(
    userId: string,
    type: NotificationType,
    payload: NotifyPayload,
  ): Promise<void> {
    await this.notifyInApp(userId, type, payload);
    await this.notificationQueue.add(
      JOB_NAMES.SEND_NOTIFICATION,
      { userId, type, payload, channel: 'email' } satisfies NotificationJobData,
      {
        attempts: NOTIFICATION_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: NOTIFICATION_JOB_BACKOFF_MS },
      },
    );
  }

  /**
   * Will a WhatsApp send actually be ATTEMPTED for this user? The API asks
   * before promising a channel; the worker applies the SAME predicate when it
   * decides to send or downgrade (whatsapp-deliverability.ts is the one
   * definition). Non-candidates have no WhatsApp target — false.
   */
  async isWhatsappDeliverableFor(userId: string): Promise<boolean> {
    const profile = await this.prisma.candidateProfile.findFirst({
      where: { userId },
      select: { phone: true, whatsappCapable: true, waNotifications: true },
    });
    return isWhatsappDeliverable(profile);
  }

  // ── Candidate read endpoints ────────────────────────────────────────────────

  async listNotifications(
    userId: string,
    dto: ListNotificationsDto,
  ): Promise<Paginated<NotificationDto>> {
    const { page, pageSize, skip, take } = resolvePaging(dto.page, dto.pageSize);

    const where = {
      userId,
      ...(dto.unread && { readAt: null }),
      ...(dto.filter && { type: { in: FILTER_BUCKETS[dto.filter] } }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data: rows.map(toNotificationDto), meta: pageMeta(page, pageSize, total) };
  }

  async markRead(userId: string, dto: MarkReadDto): Promise<void> {
    if (dto.all) {
      await this.prisma.notification.updateMany({
        where: { userId, readAt: null },
        data: { readAt: new Date() },
      });
      return;
    }
    if (dto.ids?.length) {
      await this.prisma.notification.updateMany({
        where: { userId, id: { in: dto.ids }, readAt: null },
        data: { readAt: new Date() },
      });
    }
  }

  // ── Delivery-status update methods (called by webhook controllers in S5) ────

  /**
   * Transition a WhatsApp message's delivery status.
   * Called by the Meta webhook controller (S5) when a status callback arrives.
   * For the mock, call this directly in tests to simulate the SENT→DELIVERED transition.
   */
  async updateWhatsAppDeliveryStatus(waMessageId: string, status: DeliveryStatus): Promise<void> {
    await this.prisma.whatsappMessage.updateMany({
      where: { waMessageId },
      data: { status, statusUpdatedAt: new Date() },
    });
  }

  /**
   * Transition an email message's delivery status.
   * Called by the SES event webhook controller (S5) when a delivery/bounce event arrives.
   */
  async updateEmailDeliveryStatus(
    sesMessageId: string,
    status: DeliveryStatus,
    bounceType?: string,
  ): Promise<void> {
    await this.prisma.emailMessage.updateMany({
      where: { sesMessageId },
      data: { status, ...(bounceType && { bounceType }) },
    });
  }

  assertCandidateRole(role: UserRole): void {
    if (role !== UserRole.CANDIDATE) {
      throw new ForbiddenException({ code: 'NOT_CANDIDATE' });
    }
  }

  assertEmployerRole(role: UserRole): void {
    if (role !== UserRole.EMPLOYER) {
      throw new ForbiddenException({ code: 'NOT_EMPLOYER' });
    }
  }
}
