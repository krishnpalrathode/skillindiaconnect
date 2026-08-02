import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { DeliveryStatus, NotificationType, WaMessageKind } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { RESPONSIVE_WORKER_OPTS } from '../queue/worker-tuning';
import { WHATSAPP_CHANNEL, WhatsappChannel } from './channels/whatsapp.channel';
import { EMAIL_CHANNEL, EmailChannel } from './channels/email.channel';
import { NOTIFICATION_MATRIX } from './notification.matrix';
import { NotificationJobData, NotifyPayload } from './notification.types';
import { isWhatsappDeliverable } from './whatsapp-deliverability';

// RESPONSIVE tier: a candidate is waiting on the other end of these sends.
// Pickup latency is unaffected — see worker-tuning.ts on the v5 marker.
@Processor(QUEUE_NAMES.NOTIFICATION, RESPONSIVE_WORKER_OPTS)
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
    // Application-linked sends (e.g. APPLICATION_SELECTED) carry the id in the
    // notify payload — thread it onto the delivery row for traceability.
    const applicationId =
      typeof payload.data?.['applicationId'] === 'string'
        ? (payload.data['applicationId'] as string)
        : null;

    // ── Downgrade: user not WhatsApp-capable or has opted out ─────────────────
    // Distinct from the failure-fallback path (tried to send but failed).
    // The predicate is SHARED with the API (S7-B2 resume send reads it to state
    // the real channel in its 202) — one definition, no drift.
    if (!isWhatsappDeliverable(profile)) {
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
            applicationId,
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
    // One row per LOGICAL send: the first attempt creates it and pins its id on
    // the job (BullMQ persists updateData across retries), so retry attempts
    // UPDATE that same row instead of minting a FAILED row per attempt.
    let msgRow =
      job.data.waMessageRowId != null
        ? await this.prisma.whatsappMessage.findUnique({
            where: { id: job.data.waMessageRowId },
          })
        : null;
    if (msgRow) {
      msgRow = await this.prisma.whatsappMessage.update({
        where: { id: msgRow.id },
        data: { status: DeliveryStatus.QUEUED, statusUpdatedAt: new Date(), errorCode: null },
      });
    } else {
      msgRow = await this.prisma.whatsappMessage.create({
        data: {
          userId,
          phone: profile.phone!,
          kind,
          templateName: templateKey,
          status: DeliveryStatus.QUEUED,
          applicationId,
        },
      });
      await job.updateData({ ...job.data, waMessageRowId: msgRow.id });
    }

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
      //
      // CHAOS-004 (S8-H3) — OFF-BY-ONE: this was `job.attemptsMade >= maxAttempts`,
      // which is NEVER true inside the processor. BullMQ increments
      // `attemptsMade` when an attempt FAILS, so while the Nth attempt is
      // running the counter still reads N-1: on the final attempt of a
      // 3-attempt job it is 2, and `2 >= 3` is false. The fallback therefore
      // never ran — chaos testing drove a real WhatsApp rejection through the
      // production config and observed the delivery row correctly marked FAILED
      // while ZERO email was sent.
      //
      // The consequence in production is silent and serious: WhatsApp is the
      // primary channel for these candidates, and the events that use it
      // include "you have been selected". The row said FAILED (so the system was
      // never dishonest), but the promised downgrade to email did not happen and
      // the candidate simply heard nothing.
      //
      // `attemptsMade + 1` is the number of the attempt currently executing, so
      // this now reads "is this the last attempt?" — true exactly once, on the
      // final try.
      const maxAttempts = job.opts.attempts ?? 1;
      const thisAttemptNumber = job.attemptsMade + 1;
      if (thisAttemptNumber >= maxAttempts) {
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

    // Check email opt-in preference for candidates. Security/transactional mail
    // (matrix `transactional: true`) BYPASSES it — the toggle governs
    // notifications, and must not silently swallow a password-reset link the
    // user just requested to get back into their own account.
    if (!NOTIFICATION_MATRIX[type].transactional) {
      const profile = await this.prisma.candidateProfile.findFirst({
        where: { userId },
        select: { emailNotifs: true },
      });
      if (profile?.emailNotifs === false) {
        // User has opted out of email notifications — silently skip.
        return;
      }
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
