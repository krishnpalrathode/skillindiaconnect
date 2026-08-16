import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { NotificationType, UserRole } from '@prisma/client';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../core/redis/redis.provider';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { NotificationService } from '../notifications/notification.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { ResumeService } from './resume.service';

/** CR-001: five WhatsApp resume sends per candidate per day. */
export const RESUME_SEND_CAP_PER_DAY = 5;
const RESUME_SEND_WINDOW_S = 24 * 60 * 60;

export type ResumeDeliveryChannel = 'WHATSAPP' | 'EMAIL_FALLBACK' | 'EMAIL';

/**
 * "Suresh Kumar Yadav" → "Suresh-Kumar-Yadav-Resume.pdf" (CR-WA W0).
 *
 * This is what the candidate sees in WhatsApp and what lands in their phone's
 * downloads, so it is deliberately human rather than a uuid. Stripped to a safe
 * ASCII subset because the name is user input and this string ends up in a
 * Content-Disposition header at the provider.
 */
export function buildResumeFilename(name: string): string {
  const safe = name
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return safe ? `${safe}-Resume.pdf` : 'Resume.pdf';
}

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
    private readonly candidateRead: CandidateReadService,
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
    // CR-WA W0: the WhatsApp template's parameters are supplied by THIS module,
    // which owns the resume — the notification worker must not go looking for a
    // candidate's name (module-boundaries Rule 4).
    //
    // THE NAME COMES FROM THE GENERATION'S OWN SNAPSHOT, not the live profile.
    // The candidate forwards the attached PDF; a greeting that disagrees with
    // the name printed on the attachment reads as someone else's document. The
    // snapshot IS what those bytes say, so they cannot drift.
    //
    // Legacy rows (pre-S7-B2) carry no viewSnapshot — those fall back to the
    // live name, which is the best available answer for a PDF whose contents
    // were never recorded.
    const name = await this.resolveSnapshotName(generation, candidateId);

    await this.notifications.notify(userId, NotificationType.RESUME_SENT, {
      title: 'Your resume',
      body: 'Your resume PDF is on its way.',
      // Ids and an R2 KEY only — the media binding is resolved worker-side at
      // send time. No signed url travels in job data (it would outlive its 5
      // minutes in Redis and is a document url either way), and no bytes.
      data: {
        generationId: generation.id,
        channel: delivered,
        // Ordered {{1}}..{{n}} for the approved document template.
        templateVars: [name],
        documentKey: generation.r2Key,
        // The filename the candidate sees and keeps. Named HERE because this is
        // the module that knows the document is a résumé.
        documentFilename: buildResumeFilename(name),
      },
    });

    await this.auditDelivery(AUDIT_ACTIONS.RESUME_SENT, userId, generation.id, delivered);
    return { delivered };
  }

  /**
   * THE NAME COMES FROM THE GENERATION'S OWN SNAPSHOT, not the live profile.
   * The candidate forwards the attached PDF; a greeting or filename that
   * disagrees with the name printed on the attachment reads as someone else's
   * document. The snapshot IS what those bytes say, so they cannot drift.
   *
   * Legacy rows (pre-S7-B2) carry no viewSnapshot — those fall back to the live
   * name, the best available answer for a PDF whose contents were never
   * recorded.
   *
   * Shared by BOTH delivery paths deliberately: they must name the same file for
   * the same generation, and two copies of this is how that drifts.
   */
  private async resolveSnapshotName(
    generation: { viewSnapshot: unknown },
    candidateId: string,
  ): Promise<string> {
    const snapshot = generation.viewSnapshot as { fullName?: unknown } | null;
    const snapshotName =
      typeof snapshot?.fullName === 'string' && snapshot.fullName.length > 0
        ? snapshot.fullName
        : null;
    return (
      snapshotName ?? (await this.candidateRead.getNamesByIds([candidateId])).get(candidateId) ?? ''
    );
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

    // The document the body PROMISES. Without these two keys the worker had
    // nothing to attach, so "Your resume PDF is attached" arrived with no PDF.
    // Same keys the WhatsApp path supplies — the worker resolves the bytes from
    // R2 at send time, so no signed url or payload bloat travels in job data.
    const name = await this.resolveSnapshotName(generation, candidateId);

    await this.notifications.enqueueEmail(userId, NotificationType.RESUME_SENT, {
      title: 'Your resume',
      body: 'Your resume PDF is attached.',
      data: {
        generationId: generation.id,
        channel: 'EMAIL',
        documentKey: generation.r2Key,
        documentFilename: buildResumeFilename(name),
      },
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
