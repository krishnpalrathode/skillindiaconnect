import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { DeliveryStatus, NotificationType, WaMessageKind } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { WHATSAPP_CHANNEL, WhatsappChannel } from './channels/whatsapp.channel';
import { EMAIL_CHANNEL, EmailChannel } from './channels/email.channel';
import { NOTIFICATION_MATRIX } from './notification.matrix';
import { NotificationJobData, NotifyPayload } from './notification.types';

@Processor(QUEUE_NAMES.NOTIFICATION)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_CHANNEL) private readonly whatsappChannel: WhatsappChannel,
    @Inject(EMAIL_CHANNEL) private readonly emailChannel: EmailChannel,
    private readonly auditService: AuditService,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    if (job.data.channel === 'whatsapp') {
      await this.processWhatsapp(job);
    } else {
      await this.processEmail(job);
    }
  }

  // ── WhatsApp channel ─────────────────────────────────────────────────────────

  private async processWhatsapp(job: Job<NotificationJobData>): Promise<void> {
    const { userId, type, payload } = job.data;

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });

    const profile = await this.prisma.candidateProfile.findFirst({
      where: { userId },
      select: { phone: true, whatsappCapable: true, waNotifications: true },
    });

    const matrixEntry = NOTIFICATION_MATRIX[type];
    const templateKey = matrixEntry.whatsappTemplate ?? type;
    const kind = matrixEntry.whatsappKind ?? WaMessageKind.STATUS_UPDATE;

    // ── Downgrade: user not WhatsApp-capable or has opted out ─────────────────
    // Distinct from the failure-fallback path (tried to send but failed).
    const isCapable = profile?.whatsappCapable && profile?.phone && profile?.waNotifications !== false;
    if (!isCapable) {
      if (profile?.phone) {
        // Record the downgrade attempt (phone present but not capable/opted-out)
        await this.prisma.whatsappMessage.create({
          data: {
            userId,
            phone: profile.phone,
            kind,
            templateName: templateKey,
            status: DeliveryStatus.FAILED,
            errorCode: 'NOT_WHATSAPP_CAPABLE',
            statusUpdatedAt: new Date(),
          },
        });
      }
      await this.auditService.log({
        module: AUDIT_MODULES.NOTIFICATIONS,
        action: AUDIT_ACTIONS.NOTIFICATION_DELIVERED,
        status: AuditStatus.FAILED,
        actorUserId: userId,
        meta: { type, channel: 'whatsapp→email', reason: 'whatsapp_downgrade' },
      });
      // Fallback to email (downgrade, not failure — no rethrow)
      await this.sendEmailDirect(userId, user.email, type, payload, 'whatsapp-downgrade');
      return;
    }

    // ── Attempt WhatsApp send ──────────────────────────────────────────────────
    const msgRow = await this.prisma.whatsappMessage.create({
      data: {
        userId,
        phone: profile.phone!,
        kind,
        templateName: templateKey,
        status: DeliveryStatus.QUEUED,
      },
    });

    try {
      const result = await this.whatsappChannel.sendTemplate(profile.phone!, templateKey, {});

      await this.prisma.whatsappMessage.update({
        where: { id: msgRow.id },
        data: {
          waMessageId: result.providerMessageId,
          status: result.ok ? DeliveryStatus.SENT : DeliveryStatus.FAILED,
          statusUpdatedAt: new Date(),
          ...(result.errorCode && { errorCode: result.errorCode }),
        },
      });

      if (!result.ok) {
        throw new Error(`WhatsApp send failed: ${result.errorCode ?? 'unknown'}`);
      }

      await this.auditService.log({
        module: AUDIT_MODULES.NOTIFICATIONS,
        action: AUDIT_ACTIONS.NOTIFICATION_DELIVERED,
        status: AuditStatus.DELIVERED,
        actorUserId: userId,
        targetId: msgRow.id,
        // phone intentionally absent — redaction policy; providerMessageId is not PII
        meta: { type, channel: 'whatsapp', providerMessageId: result.providerMessageId },
      });
    } catch (err) {
      // ── Failure-fallback: fires ONLY on the last retry ────────────────────────
      // The downgrade path (above) is a deliberate decision not to try WA at all.
      // This path tried WA, failed after all retries, and falls back to email.
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade >= maxAttempts) {
        // Mark the row FAILED before the fallback (never silently claim delivery)
        await this.prisma.whatsappMessage
          .update({
            where: { id: msgRow.id },
            data: { status: DeliveryStatus.FAILED, statusUpdatedAt: new Date() },
          })
          .catch((updateErr: unknown) => {
            this.logger.error('Failed to mark whatsapp_message FAILED', {
              msgId: msgRow.id,
              err: String(updateErr),
            });
          });

        await this.auditService.log({
          module: AUDIT_MODULES.NOTIFICATIONS,
          action: AUDIT_ACTIONS.NOTIFICATION_FAILED,
          status: AuditStatus.FAILED,
          actorUserId: userId,
          targetId: msgRow.id,
          meta: { type, channel: 'whatsapp', reason: 'retry_exhausted' },
        });

        // Email fallback after retry exhaustion
        await this.sendEmailDirect(userId, user.email, type, payload, 'whatsapp-failure').catch(
          (fbErr: unknown) => {
            this.logger.error('Email fallback after WhatsApp failure also failed', {
              userId,
              type,
              err: String(fbErr),
            });
          },
        );
      }

      throw err; // Let BullMQ manage retries / final failure state
    }
  }

  // ── Email channel ────────────────────────────────────────────────────────────

  private async processEmail(job: Job<NotificationJobData>): Promise<void> {
    const { userId, type, payload } = job.data;

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });

    // Check email opt-in preference for candidates
    const profile = await this.prisma.candidateProfile.findFirst({
      where: { userId },
      select: { emailNotifs: true },
    });
    if (profile?.emailNotifs === false) {
      // User has opted out of email notifications — silently skip.
      return;
    }

    await this.sendEmailDirect(userId, user.email, type, payload, 'direct');
  }

  // ── Shared email-send logic (direct, not enqueued) ───────────────────────────

  private async sendEmailDirect(
    userId: string,
    toEmail: string,
    type: NotificationType,
    payload: NotifyPayload,
    reason: string,
  ): Promise<void> {
    const msgRow = await this.prisma.emailMessage.create({
      data: {
        userId,
        toEmail,
        type,
        status: DeliveryStatus.QUEUED,
      },
    });

    const result = await this.emailChannel.send(toEmail, type, payload.data ?? {});

    const finalStatus = result.ok
      ? DeliveryStatus.SENT
      : result.bounced
        ? DeliveryStatus.BOUNCED
        : DeliveryStatus.FAILED;

    await this.prisma.emailMessage.update({
      where: { id: msgRow.id },
      data: {
        sesMessageId: result.providerMessageId,
        status: finalStatus,
        ...(result.bounced && { bounceType: 'hard' }),
      },
    });

    // Audit — toEmail intentionally absent (PII); userId + type are safe
    await this.auditService.log({
      module: AUDIT_MODULES.NOTIFICATIONS,
      action: result.ok ? AUDIT_ACTIONS.NOTIFICATION_DELIVERED : AUDIT_ACTIONS.NOTIFICATION_FAILED,
      status: result.ok ? AuditStatus.DELIVERED : AuditStatus.FAILED,
      actorUserId: userId,
      targetId: msgRow.id,
      meta: {
        type,
        channel: 'email',
        reason,
        ...(result.bounced && { bounced: true }),
      },
    });

    if (!result.ok && !result.bounced) {
      throw new Error(`Email send failed: ${result.errorCode ?? 'unknown'}`);
    }
  }
}
