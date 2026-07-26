import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  NotificationType,
  OrderStatus,
  PaymentStatus,
  PlanPeriod,
  Prisma,
  SubscriptionStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { EmployerService } from '../employer/employer.service';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { MetricsService } from '../core/observability/metrics.service';
import { InvoiceService } from './invoice.service';

/** Emitted post-commit when a subscription activates (B3's quota cache etc.). */
export const PAYMENT_EVENTS = {
  SUBSCRIPTION_ACTIVATED: 'subscription.activated',
} as const;

export interface SubscriptionActivatedPayload {
  orderId: string;
  companyId: string;
  planId: string;
  subscriptionId: string;
  invoiceId: string;
}

export interface ActivationContext {
  /** Gateway payment id (pay_… / pi_…) — the payments-row unique key. */
  gatewayPaymentId: string | null;
  /** The verified event's payload — persisted on the payments row (forensics). */
  rawPayload: unknown;
  /** True when this success arrived for a FAILED/EXPIRED order (late capture). */
  lateCapture?: boolean;
}

export interface ActivationResult {
  activated: boolean;
  invoiceNumber?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * THE transaction — the single place a CREATED order becomes PAID and a
 * subscription comes alive. Called ONLY by the webhook handler (S5-B2);
 * no client callback, no admin surface, nothing else can flip an order.
 *
 * Concurrency contract: the order row is locked (`SELECT … FOR UPDATE`) and
 * the state re-check happens UNDER that lock — two simultaneous webhook
 * deliveries serialize on the lock, the second sees PAID and no-ops. One PAID
 * transition, one subscription change, ONE invoice per order, always.
 */
@Injectable()
export class ActivationService {
  private readonly logger = new Logger(ActivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceService: InvoiceService,
    private readonly employerService: EmployerService,
    private readonly notificationService: NotificationService,
    private readonly auditService: AuditService,
    private readonly eventEmitter: EventEmitter2,
    // S7-B1: the API ENQUEUES invoice rendering; the worker's Chromium renders.
    @InjectQueue(QUEUE_NAMES.INVOICE_RENDER) private readonly invoiceRenderQueue: Queue,
    // C3: the money-path activation counter the go-live alert fires on. This is
    // the outcome the whole cutover exists to watch — a silent 'failed' means a
    // customer paid and got nothing. Observability only; no logic changes here.
    private readonly metrics: MetricsService,
  ) {}

  async activate(orderId: string, ctx: ActivationContext): Promise<ActivationResult> {
    let committed: Awaited<ReturnType<typeof this.runActivationTx>>;
    try {
      committed = await this.runActivationTx(orderId, ctx);
    } catch (err) {
      // A throw here = the transaction rolled back: paid gateway-side, NOT
      // activated our-side. Record it BEFORE rethrowing so the alert fires even
      // as the webhook returns 5xx (which tells the gateway to retry).
      this.metrics.recordActivation('failed');
      throw err;
    }

    if (!committed) {
      // Idempotent no-op (already PAID/REFUNDED under the lock) — a real,
      // healthy outcome, distinct from 'failed'.
      this.metrics.recordActivation('noop');
      return { activated: false };
    }
    this.metrics.recordActivation('activated');
    return this.afterCommit(committed);
  }

  private async runActivationTx(orderId: string, ctx: ActivationContext) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Lock the order row — serializes concurrent deliveries for THIS order.
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;

      // 2. Re-check state UNDER the lock (checking before acquiring it would
      //    re-open the concurrent-delivery race this service exists to close).
      //    PAID/REFUNDED → no-op (idempotent). CREATED → the normal flow.
      //    FAILED/EXPIRED → LATE CAPTURE: the money is real, so we ACTIVATE
      //    (the documented choice) — the audit meta flags it for ops review.
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { plan: true },
      });
      if (order.status === OrderStatus.PAID || order.status === OrderStatus.REFUNDED) {
        return null; // the concurrent-duplicate killer
      }

      const now = new Date();

      // 3. Order → PAID + the payments row. gatewayPaymentId is UNIQUE — a
      //    replayed payment id upserts into a no-op rather than a second row.
      await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.PAID } });
      if (ctx.gatewayPaymentId) {
        await tx.payment.upsert({
          where: { gatewayPaymentId: ctx.gatewayPaymentId },
          create: {
            orderId,
            gatewayPaymentId: ctx.gatewayPaymentId,
            status: PaymentStatus.CAPTURED,
            paidAt: now,
            rawPayload: (ctx.rawPayload ?? {}) as Prisma.InputJsonValue,
          },
          update: {}, // replay → no-op
        });
      }

      // 4. Subscription — the B1 renewal rule applied at activation:
      //    same plan → EXTEND the existing row from max(now, current expiry)
      //    (paid time is never lost), status ACTIVE, graceEndsAt cleared;
      //    different plan (upgrade) → expire current rows, fresh term from now.
      const periodMs = (order.plan.period === PlanPeriod.YEARLY ? 365 : 30) * DAY_MS;
      const current = await tx.subscription.findFirst({
        where: { companyId: order.companyId, status: { not: SubscriptionStatus.EXPIRED } },
        orderBy: { startsAt: 'desc' },
        include: { plan: true },
      });

      let subscriptionId: string;
      if (current && current.planId === order.planId && current.plan.code !== 'FREE') {
        const base = Math.max(now.getTime(), current.expiresAt?.getTime() ?? now.getTime());
        const extended = await tx.subscription.update({
          where: { id: current.id },
          data: {
            status: SubscriptionStatus.ACTIVE,
            expiresAt: new Date(base + periodMs),
            graceEndsAt: null,
            // The row always points at the LATEST paying order (orderId is
            // unique per subscription — relinking is deliberate).
            orderId,
          },
        });
        subscriptionId = extended.id;
      } else {
        // Upgrade (or first paid plan): retire any non-FREE current term —
        // the new plan REPLACES it — then start fresh.
        if (current && current.plan.code !== 'FREE') {
          await tx.subscription.update({
            where: { id: current.id },
            data: { status: SubscriptionStatus.EXPIRED, graceEndsAt: null },
          });
        }
        const created = await tx.subscription.create({
          data: {
            companyId: order.companyId,
            planId: order.planId,
            orderId,
            status: SubscriptionStatus.ACTIVE,
            startsAt: now,
            expiresAt: new Date(now.getTime() + periodMs),
          },
        });
        subscriptionId = created.id;
      }

      // 5. The invoice ROW — number composed from invoice_number_seq INSIDE
      //    this transaction (see InvoiceService for the sequence semantics).
      const invoice = await this.invoiceService.createForOrder(tx, orderId);

      // 6. Audit in the SAME tx — commits atomically with the activation.
      //    Meta is ids + subunits only; the gateway payload never enters audit.
      await this.auditService.logInTransaction(tx, {
        actorRole: UserRole.SUPER_ADMIN, // system actor — webhook-driven
        action: AUDIT_ACTIONS.PAYMENT_CAPTURED,
        module: AUDIT_MODULES.PAYMENTS,
        targetType: 'Order',
        targetId: orderId,
        status: AuditStatus.SUCCESS,
        meta: {
          companyId: order.companyId,
          planCode: order.plan.code,
          totalSubunits: order.totalSubunits,
          ...(ctx.lateCapture && { lateCapture: true }),
        },
      });
      await this.auditService.logInTransaction(tx, {
        actorRole: UserRole.SUPER_ADMIN,
        action: AUDIT_ACTIONS.SUBSCRIPTION_ACTIVATED,
        module: AUDIT_MODULES.PAYMENTS,
        targetType: 'Subscription',
        targetId: subscriptionId,
        status: AuditStatus.SUCCESS,
        meta: { companyId: order.companyId, planCode: order.plan.code, orderId, invoiceId: invoice.id },
      });

      return {
        payload: {
          orderId,
          companyId: order.companyId,
          planId: order.planId,
          subscriptionId,
          invoiceId: invoice.id,
        } satisfies SubscriptionActivatedPayload,
        invoiceNumber: invoice.number,
        planName: order.plan.name,
      };
    });
  }

  /** Post-commit side effects — runs only for a genuinely activated order. */
  private async afterCommit(
    committed: NonNullable<Awaited<ReturnType<typeof this.runActivationTx>>>,
  ): Promise<ActivationResult> {
    const { orderId } = committed.payload;

    // 7. Post-commit, fire-safe side effects: the domain event + the
    //    SUBSCRIPTION_PURCHASED notification (email + in-app per the matrix —
    //    NotificationService enqueues; the WORKER sends, per
    //    worker-and-external-sends). A notification hiccup never un-activates.
    this.eventEmitter.emit(PAYMENT_EVENTS.SUBSCRIPTION_ACTIVATED, committed.payload);

    // 7b. S7-B1 (the S5-B2 debt): enqueue the invoice-PDF render for the row
    //     step 5 just created with pdfKey NULL. Post-commit and fire-safe —
    //     a queue hiccup never un-activates, and the daily backfill sweep is
    //     the safety net that re-enqueues any invoice still unrendered.
    //     Deterministic jobId ('-' not ':', BullMQ v5) dedupes double enqueues.
    try {
      await this.invoiceRenderQueue.add(
        JOB_NAMES.RENDER_INVOICE,
        { invoiceId: committed.payload.invoiceId },
        { jobId: `render-invoice-${committed.payload.invoiceId}` },
      );
    } catch (err) {
      this.logger.error(
        `invoice render enqueue failed for ${committed.payload.invoiceId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    try {
      const employerUserId = await this.employerService.getPrimaryUserIdForCompany(
        committed.payload.companyId,
      );
      if (employerUserId) {
        await this.notificationService.notify(
          employerUserId,
          NotificationType.SUBSCRIPTION_PURCHASED,
          {
            title: 'Subscription activated',
            body: `Your ${committed.planName} plan is now active. Invoice ${committed.invoiceNumber}.`,
            data: { orderId, invoiceNumber: committed.invoiceNumber },
          },
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`post-activation notification failed for order ${orderId}: ${msg}`);
    }

    return { activated: true, invoiceNumber: committed.invoiceNumber };
  }
}
