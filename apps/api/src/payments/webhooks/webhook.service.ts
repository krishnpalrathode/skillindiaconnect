import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../../audit/audit.types';
import { MetricsService } from '../../core/observability/metrics.service';
import {
  PaymentGatewayPort,
  RAZORPAY_GATEWAY,
  STRIPE_GATEWAY,
} from '../gateways/payment-gateway.interface';
import { PaymentEventsHandler, WebhookProvider } from './handlers/payment-events.handler';

const SIGNATURE_HEADER: Record<WebhookProvider, string> = {
  razorpay: 'x-razorpay-signature',
  stripe: 'stripe-signature',
};

/**
 * The webhook pipeline — verify → dedupe → dispatch → 200. This unit is the
 * reason api-conventions' webhook rules exist:
 *
 *  1. VERIFY BEFORE PARSE: the adapter checks the signature against the RAW
 *     bytes; `JSON.parse` runs only after it passes. Failure → 401 + a
 *     `webhook.rejected` audit carrying provider + reason ONLY (never the
 *     payload), and processing STOPS.
 *  2. DEDUPE on (provider, eventId) via the webhook_events unique: a replay
 *     is a SUCCESS to the sender — 200 immediately, `webhook.duplicate`
 *     audit, zero side effects. Exception: if the prior attempt ended in
 *     ERROR, the retry re-processes (a gateway retry after our transient
 *     failure must not be swallowed by our own dedupe row).
 *  3. DISPATCH synchronously, then 200. The activation transaction is quick
 *     (one lock, four writes); if any handler step grows slow, THE ENQUEUE
 *     SEAM IS HERE — swap `handler.handle(...)` for a BullMQ add and move the
 *     handler to the worker. Kept synchronous now because activation must
 *     not race its own retry.
 *  4. The outcome lands on the webhook_events row (processedAt + status).
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly handler: PaymentEventsHandler,
    private readonly audit: AuditService,
    @Inject(RAZORPAY_GATEWAY) private readonly razorpay: PaymentGatewayPort,
    @Inject(STRIPE_GATEWAY) private readonly stripe: PaymentGatewayPort,
    // C3: the webhook throughput/latency counter the go-live "webhook lag"
    // alert reads. `outcome` is a bounded label set (rejected | duplicate |
    // error | the handler outcomes). Observability only.
    private readonly metrics: MetricsService,
  ) {}

  async process(
    provider: WebhookProvider,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<void> {
    const startedAt = Date.now();
    const record = (outcome: string): void =>
      this.metrics.recordWebhook(provider, outcome, Date.now() - startedAt);
    const adapter = provider === 'razorpay' ? this.razorpay : this.stripe;

    // ── 1. Verify (on the raw bytes; the body is NEVER parsed on this path) ──
    const sigHeader = headers[SIGNATURE_HEADER[provider]];
    const signature = typeof sigHeader === 'string' ? sigHeader : '';
    let verified = false;
    try {
      verified = adapter.verifyWebhook(rawBody, signature);
    } catch (err) {
      // Adapter misconfiguration (missing secret) — log the config truth,
      // reject the event like any unverifiable one.
      this.logger.error(
        `${provider} webhook verification unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!verified) {
      await this.audit.log({
        actorRole: UserRole.SUPER_ADMIN,
        action: AUDIT_ACTIONS.WEBHOOK_REJECTED,
        module: AUDIT_MODULES.PAYMENTS,
        targetType: 'Webhook',
        status: AuditStatus.FAILED,
        meta: { provider, reason: signature ? 'bad_signature' : 'missing_signature' },
      });
      record('rejected');
      throw new UnauthorizedException({ code: 'INVALID_SIGNATURE' });
    }

    // ── 2. Parse + dedupe on (provider, eventId) ──────────────────────────────
    const event = adapter.parseEvent(rawBody, headers);
    let rowId: string;
    try {
      const row = await this.prisma.webhookEvent.create({
        data: {
          provider,
          eventId: event.eventId,
          payload: event.payload as Prisma.InputJsonValue,
          status: 'RECEIVED',
        },
      });
      rowId = row.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Replay. If the prior attempt ERRORED, this gateway retry is our
        // second chance — re-process against the existing row. Otherwise a
        // replay is a success to the sender: 200, audit, stop.
        const existing = await this.prisma.webhookEvent.findUniqueOrThrow({
          where: { provider_eventId: { provider, eventId: event.eventId } },
        });
        if (existing.status !== 'ERROR') {
          await this.audit.log({
            actorRole: UserRole.SUPER_ADMIN,
            action: AUDIT_ACTIONS.WEBHOOK_DUPLICATE,
            module: AUDIT_MODULES.PAYMENTS,
            targetType: 'Webhook',
            targetId: existing.id,
            status: AuditStatus.SUCCESS,
            meta: { provider, eventId: event.eventId, eventType: event.type },
          });
          record('duplicate');
          return; // 200 — zero side effects
        }
        rowId = existing.id;
      } else {
        throw err;
      }
    }

    await this.audit.log({
      actorRole: UserRole.SUPER_ADMIN,
      action: AUDIT_ACTIONS.WEBHOOK_RECEIVED,
      module: AUDIT_MODULES.PAYMENTS,
      targetType: 'Webhook',
      targetId: rowId,
      status: AuditStatus.SUCCESS,
      meta: { provider, eventId: event.eventId, eventType: event.type },
    });

    // ── 3. Dispatch + record the outcome ─────────────────────────────────────
    try {
      const outcome = await this.handler.handle(provider, event);
      await this.prisma.webhookEvent.update({
        where: { id: rowId },
        data: { processedAt: new Date(), status: `PROCESSED:${outcome}` },
      });
      record(outcome);
    } catch (err) {
      // Mark ERROR (a later gateway retry re-processes — see the dedupe
      // exception above) and let the 5xx tell the gateway to retry.
      record('error');
      await this.prisma.webhookEvent
        .update({ where: { id: rowId }, data: { processedAt: new Date(), status: 'ERROR' } })
        .catch(() => undefined);
      this.logger.error(
        `${provider} webhook handling failed (eventId=${event.eventId}): ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
