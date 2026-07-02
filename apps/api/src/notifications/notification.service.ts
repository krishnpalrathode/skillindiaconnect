import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { DeliveryStatus, Notification, NotificationType, Prisma, UserRole } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../core/prisma/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { NOTIFICATION_MATRIX } from './notification.matrix';
import {
  NotifyPayload,
  NotificationJobData,
  NOTIFICATION_JOB_ATTEMPTS,
  NOTIFICATION_JOB_BACKOFF_MS,
} from './notification.types';
import {
  ListNotificationsDto,
  FILTER_BUCKETS,
} from './dto/list-notifications.dto';
import { MarkReadDto } from './dto/mark-read.dto';

@Injectable()
export class NotificationService {
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
  async notify(userId: string, type: NotificationType, payload: NotifyPayload): Promise<void> {
    const entry = NOTIFICATION_MATRIX[type];

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

    if (entry.whatsapp) {
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

  // ── Candidate read endpoints ────────────────────────────────────────────────

  async listNotifications(
    userId: string,
    dto: ListNotificationsDto,
  ): Promise<{ data: Notification[]; nextCursor: string | null }> {
    const limit = Math.min(dto.limit ?? 20, 100);

    const rows = await this.prisma.notification.findMany({
      where: {
        userId,
        ...(dto.unread && { readAt: null }),
        ...(dto.filter && { type: { in: FILTER_BUCKETS[dto.filter] } }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(dto.cursor && { cursor: { id: dto.cursor }, skip: 1 }),
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;

    return { data, nextCursor };
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
  async updateWhatsAppDeliveryStatus(
    waMessageId: string,
    status: DeliveryStatus,
  ): Promise<void> {
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
}
