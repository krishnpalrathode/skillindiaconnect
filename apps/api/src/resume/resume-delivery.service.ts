import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { NotificationType, UserRole } from '@prisma/client';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../core/redis/redis.provider';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { NotificationService } from '../notifications/notification.service';
import { ResumeService } from './resume.service';

/** CR-001: five WhatsApp resume sends per candidate per day. */
export const RESUME_SEND_CAP_PER_DAY = 5;
const RESUME_SEND_WINDOW_S = 24 * 60 * 60;

export type ResumeDeliveryChannel = 'WHATSAPP' | 'EMAIL_FALLBACK' | 'EMAIL';

/**
 * Resume delivery (S7-B2, API-PROCESS side).
 *
 * THE SPLIT, again: nothing here sends anything. The API resolves WHICH
 * channel will really be used, enqueues, and answers honestly; the WORKER owns
 * every external send (worker-and-external-sends.md).
 *
 * THE HONESTY RULE this service exists to keep: a candidate without WhatsApp
 * still gets their resume — by email — and the response SAYS SO
 * (`EMAIL_FALLBACK`). The two failure modes we refuse are a silent no-op
 * (they think it sent; nothing did) and a false success (`WHATSAPP` when the
 * worker downgraded). The capability predicate the API reads here is the
 * SAME one the worker applies when it decides
 * (notifications/whatsapp-deliverability.ts) — one definition, so the answer
 * and the action cannot disagree.
 */
@Injectable()
export class ResumeDeliveryService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly resumeService: ResumeService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * POST /send-whatsapp — the three stacked gates, in this order:
   *   1. READY-required   → 422 RESUME_NOT_READY
   *   2. 5/day rate limit → 429 RESUME_SEND_LIMIT_EXCEEDED
   *   3. whatsappCapable  → WhatsApp document send, or an HONEST email fallback
   *
   * Order matters: a candidate blocked by gate 1 has not spent a send, so the
   * budget is consumed only AFTER the resume is known to exist.
   */
  async sendWhatsapp(
    userId: string,
    candidateId: string,
  ): Promise<{ delivered: ResumeDeliveryChannel }> {
    const generation = await this.resumeService.requireReadyGeneration(
      candidateId,
      'RESUME_NOT_READY',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );

    await this.applySendBudget(candidateId);

    // Gate 3. The document send goes to the candidate's OWN verified number —
    // there is no destination parameter on this endpoint, and there never will
    // be: "send to myself" must not become "send to anyone".
    const deliverable = await this.notifications.isWhatsappDeliverableFor(userId);
    const delivered: ResumeDeliveryChannel = deliverable ? 'WHATSAPP' : 'EMAIL_FALLBACK';

    // ONE call either way. notify() fans out per the RESUME_SENT matrix row
    // (in-app + WhatsApp); when the candidate isn't deliverable the worker's
    // downgrade path emails them instead — the behavior this response already
    // promised. No second code path to keep in sync.
    await this.notifications.notify(userId, NotificationType.RESUME_SENT, {
      title: 'Your resume',
      body: 'Your resume PDF is on its way.',
      // Ids only — the media binding is resolved worker-side at send time.
      // No signed url travels in job data (it would outlive its 5 minutes in
      // Redis and is a document url either way).
      data: { generationId: generation.id, channel: delivered },
    });

    await this.auditDelivery(AUDIT_ACTIONS.RESUME_SENT, userId, generation.id, delivered);
    return { delivered };
  }

  /**
   * POST /send-email — email-to-self.
   *
   * HARD RULE (viewer-aware-dto.md): the destination is the candidate's own
   * ACCOUNT email, resolved server-side from their user row. No `to` field
   * exists on this endpoint.
   *
   * NO dedicated daily cap (stated): email-to-self is cheap and self-limiting,
   * and CR-001's 5/day sits where the cost actually is — the WhatsApp send.
   * The global authenticated rate limit (100/min) still applies.
   */
  async sendEmail(
    userId: string,
    candidateId: string,
  ): Promise<{ delivered: ResumeDeliveryChannel }> {
    const generation = await this.resumeService.requireReadyGeneration(
      candidateId,
      'RESUME_NOT_READY',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );

    await this.notifications.enqueueEmail(userId, NotificationType.RESUME_SENT, {
      title: 'Your resume',
      body: 'Your resume PDF is attached.',
      data: { generationId: generation.id, channel: 'EMAIL' },
    });

    await this.auditDelivery(AUDIT_ACTIONS.RESUME_EMAILED, userId, generation.id, 'EMAIL');
    return { delivered: 'EMAIL' };
  }

  /**
   * Redis budget, keyed `resume:send:wa:{candidateId}:{YYYY-MM-DD}` with a 24h
   * TTL. The date in the key makes the window a calendar day (UTC) rather than
   * a rolling one, so "5 a day" means what a worker would assume it means, and
   * the key expires on its own — no sweeper.
   */
  private async applySendBudget(candidateId: string): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    const key = `resume:send:wa:${candidateId}:${day}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, RESUME_SEND_WINDOW_S);
    if (count > RESUME_SEND_CAP_PER_DAY) {
      throw new HttpException(
        {
          code: 'RESUME_SEND_LIMIT_EXCEEDED',
          detail: "You've reached today's resume send limit. Try again tomorrow.",
          meta: { cap: RESUME_SEND_CAP_PER_DAY, windowHours: 24 },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Meta carries the CHANNEL ACTUALLY USED and ids — never phone or email. */
  private async auditDelivery(
    action: string,
    userId: string,
    generationId: string,
    delivered: ResumeDeliveryChannel,
  ): Promise<void> {
    await this.audit.log({
      actorUserId: userId,
      actorRole: UserRole.CANDIDATE,
      action,
      module: AUDIT_MODULES.CANDIDATE,
      targetType: 'ResumeGeneration',
      targetId: generationId,
      status: AuditStatus.SUCCESS,
      meta: { channel: delivered },
    });
  }
}
