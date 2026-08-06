import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DeliveryStatus } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { MetricsService } from '../../core/observability/metrics.service';

/**
 * Meta delivery status → our DeliveryStatus, with a RANK.
 *
 * The rank is what makes out-of-order callbacks safe. Meta does not guarantee
 * ordering and retries aggressively, so a 'sent' can legitimately arrive after
 * a 'delivered'. Without a rank the later-arriving 'sent' would overwrite the
 * 'delivered' and the row would claim LESS than we actually know — the mirror
 * image of the false-success this codebase guards against everywhere else.
 *
 * FAILED is terminal from any state and is deliberately ranked highest: once a
 * provider tells us a message failed, no earlier optimistic status may undo it.
 */
const STATUS_RANK: Record<DeliveryStatus, number> = {
  [DeliveryStatus.QUEUED]: 0,
  [DeliveryStatus.SENT]: 1,
  [DeliveryStatus.DELIVERED]: 2,
  [DeliveryStatus.READ]: 3,
  [DeliveryStatus.BOUNCED]: 4,
  [DeliveryStatus.FAILED]: 5,
};

const META_STATUS: Record<string, DeliveryStatus> = {
  sent: DeliveryStatus.SENT,
  delivered: DeliveryStatus.DELIVERED,
  read: DeliveryStatus.READ,
  failed: DeliveryStatus.FAILED,
};

/**
 * Which handshake check failed. Describes the request SHAPE, never the secret,
 * so it is safe to return to an unauthenticated caller.
 */
export type HandshakeFailure =
  | 'VERIFY_TOKEN_NOT_CONFIGURED'
  | 'BAD_HUB_MODE'
  | 'MISSING_HUB_PARAMS'
  | 'TOKEN_MISMATCH';

export type HandshakeResult =
  | { ok: true; challenge: string }
  | { ok: false; reason: HandshakeFailure };

/** One status update lifted out of Meta's nested envelope. */
export interface WhatsappStatusUpdate {
  waMessageId: string;
  status: DeliveryStatus;
  errorCode?: string;
}

export interface StatusApplyResult {
  applied: number;
  ignored: number;
  unknown: number;
}

/**
 * The WhatsApp delivery-status webhook (CR-WA W2).
 *
 * THIS IS WHAT FINALLY CLOSES THE SEAM. `whatsapp_messages.status` has always
 * defaulted to QUEUED with a `statusUpdatedAt` column beside it, and until now
 * nothing but the send itself ever wrote to them — no row could advance past
 * SENT because there was no receiver for the provider's callbacks. That is the
 * concrete meaning of worker-and-external-sends.md's "never silently claim a
 * notification was delivered": we could not claim delivery, because we never
 * learned of it.
 */
@Injectable()
export class WhatsappWebhookService {
  private readonly logger = new Logger(WhatsappWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  // ── Subscription handshake ────────────────────────────────────────────────

  /**
   * Meta's GET verification.
   *
   * The token is compared CONSTANT-TIME, like the payments adapter does: a
   * length-leaking or early-exit comparison on a shared secret is the kind of
   * detail that is free to get right and awkward to explain afterwards.
   *
   * ⚠️ THE RESULT NAMES *WHICH* CHECK FAILED, and that is not cosmetic.
   *
   * This previously returned `string | null`, so all four rejection paths
   * collapsed into one `null` and the controller answered every one of them
   * with `INVALID_VERIFY_TOKEN`. Meta's dashboard reports a single generic
   * error regardless, so those two facts together meant a missing
   * `hub.challenge`, a wrong `hub.mode`, and an unset env var all presented as
   * "wrong verify token" — sending you to re-check the one thing that was
   * correct. Verified against production: a request with NO `hub.challenge`
   * and a bad token returns the identical `403 INVALID_VERIFY_TOKEN` body as a
   * plain token mismatch.
   *
   * The reason is safe to expose: it describes the SHAPE of the request, never
   * the secret. `TOKEN_MISMATCH` still maps to the original
   * `INVALID_VERIFY_TOKEN` code so the documented contract is unchanged.
   */
  verifyHandshake(mode: unknown, token: unknown, challenge: unknown): HandshakeResult {
    const expected = this.config.get<string>('WHATSAPP_VERIFY_TOKEN');

    if (!expected) {
      this.logger.error('WHATSAPP_VERIFY_TOKEN is not set — refusing the subscription handshake');
      return { ok: false, reason: 'VERIFY_TOKEN_NOT_CONFIGURED' };
    }
    if (mode !== 'subscribe') return { ok: false, reason: 'BAD_HUB_MODE' };
    if (typeof token !== 'string' || typeof challenge !== 'string') {
      return { ok: false, reason: 'MISSING_HUB_PARAMS' };
    }
    if (!constantTimeEquals(token, expected)) {
      // The supplied token is NEVER logged — it is a guess at a shared secret.
      // Lengths are, because a trailing newline pasted into either the platform
      // env var or the Meta dashboard field is invisible in both UIs and is the
      // single most common cause of a mismatch.
      this.logger.warn(
        'WhatsApp webhook handshake rejected: verify token mismatch ' +
          `(receivedLength=${token.length} configuredLength=${expected.length} ` +
          `matchesAfterTrim=${constantTimeEquals(token.trim(), expected.trim())})`,
      );
      return { ok: false, reason: 'TOKEN_MISMATCH' };
    }
    return { ok: true, challenge };
  }


  // ── Signature ─────────────────────────────────────────────────────────────

  /**
   * HMAC-SHA256 of the RAW BYTES against WHATSAPP_APP_SECRET, compared
   * constant-time against `X-Hub-Signature-256` ('sha256=' + hex).
   *
   * Runs BEFORE any parsing — the same discipline as the Razorpay webhook. A
   * body that fails this is never JSON.parsed, so a malformed or hostile
   * payload cannot reach a parser on an unauthenticated endpoint.
   */
  verifySignature(rawBody: Buffer, signatureHeader: unknown): boolean {
    const secret = this.config.get<string>('WHATSAPP_APP_SECRET');
    if (!secret) {
      // Fail CLOSED. A missing secret must never mean "accept everything".
      this.logger.error('WHATSAPP_APP_SECRET is not set — rejecting the webhook');
      return false;
    }
    if (typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) return false;

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return constantTimeEquals(signatureHeader.slice('sha256='.length), expected);
  }

  // ── Status handling ───────────────────────────────────────────────────────

  /**
   * Lift status updates out of Meta's envelope:
   *   entry[].changes[].value.statuses[]
   *
   * Anything else — inbound `messages[]`, unrecognised change types — yields an
   * empty list. Inbound conversational handling is explicitly out of scope at
   * MVP, and an unrecognised payload must be a no-op, not an error.
   */
  extractStatuses(payload: unknown): WhatsappStatusUpdate[] {
    const updates: WhatsappStatusUpdate[] = [];
    const entries = asArray((payload as Record<string, unknown>)?.['entry']);

    for (const entry of entries) {
      for (const change of asArray(asRecord(entry)?.['changes'])) {
        const value = asRecord(asRecord(change)?.['value']);
        for (const raw of asArray(value?.['statuses'])) {
          const s = asRecord(raw);
          const id = s?.['id'];
          const status = s?.['status'];
          if (typeof id !== 'string' || typeof status !== 'string') continue;

          const mapped = META_STATUS[status];
          if (!mapped) continue; // an unknown status is ignored, not an error

          const update: WhatsappStatusUpdate = { waMessageId: id, status: mapped };

          if (mapped === DeliveryStatus.FAILED) {
            // The CODE only. Meta's error title/details can echo the recipient's
            // number, and this lands in a column we read in support tooling.
            const firstError = asRecord(asArray(s?.['errors'])[0]);
            const code = firstError?.['code'];
            if (code !== undefined) update.errorCode = `META_${String(code)}`;
          }

          updates.push(update);
        }
      }
    }

    return updates;
  }

  /**
   * Apply updates. Idempotent, out-of-order safe, and never throws for a
   * message we do not recognise.
   *
   * One row at a time on purpose: a single bad entry must not abandon the rest
   * of a batch, and the endpoint answers 200 regardless.
   */
  async applyStatuses(updates: WhatsappStatusUpdate[]): Promise<StatusApplyResult> {
    const result: StatusApplyResult = { applied: 0, ignored: 0, unknown: 0 };

    for (const update of updates) {
      try {
        const applied = await this.applyOne(update);
        if (applied === 'applied') result.applied += 1;
        else if (applied === 'ignored') result.ignored += 1;
        else result.unknown += 1;
      } catch (err) {
        // Never let one row take down the batch — Meta would retry the WHOLE
        // callback, re-delivering the ones that already succeeded.
        this.logger.error(
          `failed to apply a WhatsApp status update: ${err instanceof Error ? err.message : 'unknown'}`,
        );
        result.ignored += 1;
      }
    }

    return result;
  }

  private async applyOne(
    update: WhatsappStatusUpdate,
  ): Promise<'applied' | 'ignored' | 'unknown'> {
    const rank = STATUS_RANK[update.status];

    /**
     * A GUARDED UPDATE, not read-then-write.
     *
     * Meta retries, so two callbacks for the same message genuinely can race.
     * Reading the current status and then writing would be a TOCTOU: both reads
     * see SENT, both decide to advance, and the lower-ranked one can land last.
     * The `status: { in: [...] }` predicate makes the decision and the write one
     * atomic statement, so a regression is impossible regardless of ordering.
     */
    const lowerRanked = (Object.keys(STATUS_RANK) as DeliveryStatus[]).filter(
      (s) => STATUS_RANK[s] < rank,
    );

    const { count } = await this.prisma.whatsappMessage.updateMany({
      where: { waMessageId: update.waMessageId, status: { in: lowerRanked } },
      data: {
        status: update.status,
        // OUR clock, not Meta's timestamp: this column records when WE learned,
        // which is what an operator debugging delivery lag actually needs.
        statusUpdatedAt: new Date(),
        ...(update.errorCode ? { errorCode: update.errorCode } : {}),
      },
    });

    if (count > 0) {
      // Counted only when the status actually ADVANCED a row. Counting every
      // callback would inflate on Meta's retries and on out-of-order replays,
      // making a "delivery rate" that measures Meta's retry behaviour rather
      // than ours.
      this.metrics.recordWhatsappDeliveryStatus(update.status);
      return 'applied';
    }

    // Nothing updated: either the row is already at or above this rank (a
    // replay, or an out-of-order callback) or we have never heard of the id.
    const exists = await this.prisma.whatsappMessage.findFirst({
      where: { waMessageId: update.waMessageId },
      select: { id: true },
    });
    return exists ? 'ignored' : 'unknown';
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Constant-time string compare that does not leak length through an early exit.
 * timingSafeEqual throws on unequal lengths, so both sides are hashed to a fixed
 * width first — the standard way to compare secrets of unknown length.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest();
  const hb = createHmac('sha256', 'cmp').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}
