import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../../../audit/audit.types';
import { ActivationService } from '../../activation.service';
import { VerifiedGatewayEvent } from '../../gateways/payment-gateway.interface';

export type WebhookProvider = 'razorpay' | 'stripe';

export type HandlerOutcome =
  | 'activated'
  | 'noop'
  | 'marked_failed'
  | 'refunded'
  | 'stale_ignored'
  | 'unknown_order'
  | 'unhandled_type';

type EventFamily = 'success' | 'failure' | 'refund' | 'other';

interface NormalizedEvent {
  family: EventFamily;
  /** OUR order id (uuid) from receipt / notes.orderId / metadata.orderId. */
  orderId: string | null;
  /** The gateway-side order/session id (order_… / cs_…). */
  gatewayOrderId: string | null;
  /** The gateway payment id (pay_… / pi_… / ch_…). */
  gatewayPaymentId: string | null;
}

// ── Provider-specific normalization (pure) ────────────────────────────────────

const RAZORPAY_FAMILIES: Record<string, EventFamily> = {
  'order.paid': 'success',
  'payment.captured': 'success',
  'payment.failed': 'failure',
  'refund.processed': 'refund',
};

const STRIPE_FAMILIES: Record<string, EventFamily> = {
  'checkout.session.completed': 'success',
  'payment_intent.succeeded': 'success',
  'payment_intent.payment_failed': 'failure',
  'checkout.session.expired': 'failure',
  'charge.refunded': 'refund',
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Razorpay envelope: payload.<entity>.entity with notes/receipt carrying our id. */
export function normalizeRazorpay(event: VerifiedGatewayEvent): NormalizedEvent {
  const family = RAZORPAY_FAMILIES[event.type] ?? 'other';
  const p = event.payload as {
    payload?: {
      payment?: { entity?: { id?: string; order_id?: string; notes?: { orderId?: string } } };
      order?: { entity?: { id?: string; receipt?: string; notes?: { orderId?: string } } };
      refund?: { entity?: { id?: string; payment_id?: string; notes?: { orderId?: string } } };
    };
  };
  const payment = p.payload?.payment?.entity;
  const order = p.payload?.order?.entity;
  const refund = p.payload?.refund?.entity;
  return {
    family,
    orderId:
      str(payment?.notes?.orderId) ??
      str(order?.notes?.orderId) ??
      str(order?.receipt) ??
      str(refund?.notes?.orderId),
    gatewayOrderId: str(payment?.order_id) ?? str(order?.id),
    gatewayPaymentId: str(payment?.id) ?? str(refund?.payment_id),
  };
}

/** Stripe envelope: data.object with metadata.orderId (set at session create). */
export function normalizeStripe(event: VerifiedGatewayEvent): NormalizedEvent {
  const family = STRIPE_FAMILIES[event.type] ?? 'other';
  const p = event.payload as {
    data?: {
      object?: {
        id?: string;
        object?: string;
        metadata?: { orderId?: string };
        payment_intent?: string;
      };
    };
  };
  const obj = p.data?.object;
  const isSession = obj?.object === 'checkout.session';
  return {
    family,
    orderId: str(obj?.metadata?.orderId),
    gatewayOrderId: isSession ? str(obj?.id) : null,
    gatewayPaymentId: isSession ? str(obj?.payment_intent) : str(obj?.id),
  };
}

/**
 * The state reconciliation — act on CURRENT order state, never on event
 * sequence. Gateways deliver late, twice, and out of order; every branch
 * below checks the locked/current state first, so backward movement (a
 * failure regressing a PAID order) is impossible by construction.
 */
@Injectable()
export class PaymentEventsHandler {
  private readonly logger = new Logger(PaymentEventsHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activation: ActivationService,
    private readonly audit: AuditService,
  ) {}

  async handle(provider: WebhookProvider, event: VerifiedGatewayEvent): Promise<HandlerOutcome> {
    const norm = provider === 'razorpay' ? normalizeRazorpay(event) : normalizeStripe(event);
    if (norm.family === 'other') return 'unhandled_type';

    // Resolve OUR order: primary = the id we planted (receipt/notes/metadata);
    // fallback = the gateway order id we persisted at checkout.
    const order = norm.orderId
      ? await this.prisma.order.findUnique({ where: { id: norm.orderId } })
      : norm.gatewayOrderId
        ? await this.prisma.order.findUnique({ where: { gatewayOrderId: norm.gatewayOrderId } })
        : null;

    if (!order) {
      // 200 + audit — NEVER 404. A 4xx teaches the gateway to retry forever
      // and teaches a probing sender which order ids exist.
      await this.auditEvent(AUDIT_ACTIONS.WEBHOOK_UNKNOWN_ORDER, provider, event, null);
      return 'unknown_order';
    }

    switch (norm.family) {
      case 'success': {
        // CREATED → activate. FAILED/EXPIRED → LATE CAPTURE: the money is
        // real, so we ACTIVATE (documented choice; the activation audit
        // carries lateCapture:true for ops). PAID/REFUNDED → idempotent no-op
        // (the re-check under the activation lock is authoritative).
        const lateCapture =
          order.status === OrderStatus.FAILED || order.status === OrderStatus.EXPIRED;
        const result = await this.activation.activate(order.id, {
          gatewayPaymentId: norm.gatewayPaymentId,
          rawPayload: event.payload,
          lateCapture,
        });
        if (!result.activated) {
          await this.auditEvent(AUDIT_ACTIONS.WEBHOOK_NOOP, provider, event, order.id);
          return 'noop';
        }
        return 'activated';
      }

      case 'failure': {
        if (order.status === OrderStatus.CREATED) {
          await this.prisma.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.FAILED },
          });
          await this.auditEvent(AUDIT_ACTIONS.WEBHOOK_RECEIVED, provider, event, order.id, {
            markedFailed: true,
          });
          return 'marked_failed';
        }
        // A failure event must NEVER regress a paid order — the out-of-order core.
        await this.auditEvent(AUDIT_ACTIONS.WEBHOOK_STALE_IGNORED, provider, event, order.id);
        return 'stale_ignored';
      }

      case 'refund': {
        if (order.status === OrderStatus.PAID) {
          await this.prisma.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.REFUNDED },
          });
          // MVP: NO subscription clawback logic — the refund is recorded and
          // flagged; whether/how to revoke the term is a manual ops decision
          // (stated in the unit spec; an automated clawback is future work).
          await this.auditEvent(AUDIT_ACTIONS.PAYMENT_REFUNDED, provider, event, order.id, {
            clawback: 'manual-ops-review',
          });
          return 'refunded';
        }
        await this.auditEvent(AUDIT_ACTIONS.WEBHOOK_STALE_IGNORED, provider, event, order.id);
        return 'stale_ignored';
      }

      default:
        return 'unhandled_type';
    }
  }

  /** Audit helper — provider + event type/id + order id only. NEVER the payload. */
  private async auditEvent(
    action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
    provider: WebhookProvider,
    event: VerifiedGatewayEvent,
    orderId: string | null,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.audit.log({
      actorRole: UserRole.SUPER_ADMIN, // system actor — webhook-driven
      action,
      module: AUDIT_MODULES.PAYMENTS,
      targetType: 'Order',
      targetId: orderId ?? undefined,
      status: AuditStatus.SUCCESS,
      meta: { provider, eventType: event.type, eventId: event.eventId, ...extra },
    });
  }
}
