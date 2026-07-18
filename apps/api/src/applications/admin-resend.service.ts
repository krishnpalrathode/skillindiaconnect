import {
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApplicationStatus, NotificationType, UserRole } from '@prisma/client';
import { Redis } from 'ioredis';
import { PrismaService } from '../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../core/redis/redis.provider';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';

/** Contract-fixed cap: 3 resends per application per rolling 24h. */
export const RESEND_CAP = 3;
export const RESEND_WINDOW_S = 24 * 60 * 60;

export interface ResendActor {
  userId: string;
  role: UserRole;
}

export interface ResendResult {
  resentAt: string;
  /**
   * The honest answer at enqueue time: 'whatsapp' when the candidate is
   * WhatsApp-capable (the worker will attempt the send; delivery status lands
   * in whatsapp_messages), 'email_fallback' when whatsappCapable=false and the
   * S2-B3 downgrade means only email/in-app will actually go out.
   */
  channel: 'whatsapp' | 'email_fallback';
}

/**
 * The manual "Selected" WhatsApp resend (S6b-B2) — S4-B2's documented
 * `bypassGuard` seam going live.
 *
 * FINDING (stated): the seam exists exactly as documented
 * (TransitionOpts.bypassGuard → `sendWhatsapp: firstEntry || bypassGuard`),
 * but it is only reachable through a STATUS TRANSITION, and a resend is not
 * one — the application is already SELECTED and same-state moves are illegal
 * in the matrix. So this service is the seam's minimal sibling: it makes the
 * exact call the seam's `sendWhatsapp: true` branch makes
 * (NotificationService.notify(APPLICATION_SELECTED) with WhatsApp NOT
 * suppressed) without any application write. The API only ENQUEUES — the
 * worker owns the external send (worker-and-external-sends.md), and the
 * worker's send creates the new whatsapp_messages row that records the resend.
 *
 * `selectedNotifiedAt` is NEVER touched here: it is the GUARD recording when
 * the first automated notification fired, not a "last notified" field.
 * Overwriting it would silently rewrite the candidate's history ("Notified on
 * WhatsApp · {date}" would change) and weaken the idempotency record. A
 * "last notified" display, if ever needed, derives from whatsapp_messages.
 */
@Injectable()
export class AdminResendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidateRead: CandidateReadService,
    private readonly notificationService: NotificationService,
    private readonly auditService: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async resendSelectedWhatsapp(
    applicationId: string,
    reason: string,
    actor: ResendActor,
  ): Promise<ResendResult> {
    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { id: true, status: true, candidateId: true },
    });
    if (!app) throw new NotFoundException({ code: 'APPLICATION_NOT_FOUND' });

    // SELECTED-only: resending a selection notice for a pending/rejected
    // application is the exact harm the guard exists to prevent.
    if (app.status !== ApplicationStatus.SELECTED) {
      throw new UnprocessableEntityException({
        code: 'APPLICATION_NOT_SELECTED',
        detail: 'Only SELECTED applications can have the WhatsApp resent.',
      });
    }

    // A purged/tombstoned candidate has no phone to reach — honest 422.
    const target = app.candidateId
      ? await this.candidateRead.getNotificationTarget(app.candidateId)
      : null;
    if (!target) {
      throw new UnprocessableEntityException({
        code: 'CANDIDATE_UNAVAILABLE',
        detail: 'This application no longer has a reachable candidate.',
      });
    }

    // Rate limit — the S1-1 Redis budget pattern (INCR + EXPIRE on first hit).
    // A worker's phone is not a debugging tool: 3 per application per 24h.
    await this.applyResendBudget(applicationId);

    // The bypass send: APPLICATION_SELECTED's matrix row fans out in-app +
    // email + WhatsApp; nothing is suppressed — this IS the seam's
    // sendWhatsapp:true call. The API enqueues; the worker sends (and the
    // S2-B3 downgrade still applies for whatsappCapable=false).
    await this.notificationService.notify(target.userId, NotificationType.APPLICATION_SELECTED, {
      title: 'You have been selected',
      body: 'Congratulations — an employer has selected your application.',
      data: { applicationId: app.id, resend: true },
    });

    const resentAt = new Date();
    await this.auditService.log({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.APPLICATION_WHATSAPP_RESENT,
      module: AUDIT_MODULES.APPLICATIONS,
      targetType: 'Application',
      targetId: app.id,
      status: AuditStatus.SUCCESS,
      // Reason + capability outcome — NO phone number, ever.
      meta: {
        reason,
        whatsappCapable: target.whatsappCapable,
      },
    });

    return {
      resentAt: resentAt.toISOString(),
      channel: target.whatsappCapable ? 'whatsapp' : 'email_fallback',
    };
  }

  private async applyResendBudget(applicationId: string): Promise<void> {
    const key = `resend:wa:${applicationId}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, RESEND_WINDOW_S);
    }
    if (count > RESEND_CAP) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          detail: 'This application has reached its resend limit. Try again later.',
          meta: { cap: RESEND_CAP, windowHours: 24 },
        },
        429,
      );
    }
  }
}
