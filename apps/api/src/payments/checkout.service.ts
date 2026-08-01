import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Gateway, Order, OrderStatus, Plan, PlanPeriod, UserRole } from '@prisma/client';
import { Redis } from 'ioredis';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';
import { REDIS_CLIENT } from '../core/redis/redis.provider';
import { EmployerService } from '../employer/employer.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../settings/settings.keys';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { computeTotals } from './money';
import { RoutingService } from './routing.service';
import {
  PaymentGatewayPort,
  RAZORPAY_GATEWAY,
  STRIPE_GATEWAY,
} from './gateways/payment-gateway.interface';

/**
 * Same-plan renewal opens this many days before expiry (and stays open through
 * GRACE/EXPIRED). Inside the window a renewal EXTENDS the current term (B2
 * activates from the current expiry — paid time is never lost); outside it a
 * same-plan checkout is 409 SUBSCRIPTION_ALREADY_ACTIVE. A DIFFERENT paid plan
 * (upgrade) is allowed at any time.
 */
export const RENEWAL_WINDOW_DAYS = 7;

/** Idempotency cache TTL — 24 h per api-conventions.md. */
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Response shapes (the frozen S5-0 contract) ────────────────────────────────

export interface BillingPlanDto {
  code: string;
  name: string;
  priceSubunits: number;
  currency: string;
  period: 'MONTHLY' | 'YEARLY' | null;
  maxActiveJobs: number | null;
  /** Display hint only — the checkout response's gstSubunits is authoritative. */
  gstRatePct: number;
  features: string[];
}

export interface SubscriptionStatusDto {
  plan: BillingPlanDto;
  status: 'ACTIVE' | 'GRACE' | 'EXPIRED';
  startsAt: string;
  expiresAt: string | null;
  graceEndsAt: string | null;
  daysRemaining: number | null;
  renewable: boolean;
}

export interface CheckoutSessionDto {
  orderId: string;
  gateway: Gateway;
  amountSubunits: number;
  gstSubunits: number;
  totalSubunits: number;
  currency: string;
  razorpay?: { keyId: string; gatewayOrderId: string };
  stripe?: { redirectUrl: string };
}

export interface OrderDto {
  id: string;
  planCode: string;
  status: OrderStatus;
  gateway: Gateway;
  amountSubunits: number;
  gstSubunits: number;
  totalSubunits: number;
  currency: string;
  createdAt: string;
  subscriptionActivatedAt: string | null;
  invoiceId: string | null;
}

/** The contract's `Invoice` (S5-0; the endpoint went live in S7-B1). */
export interface InvoiceDto {
  id: string;
  number: string;
  issuedAt: string;
  totalSubunits: number;
  currency: string;
  planName: string;
  pdfUrl: string | null;
}

/** Contract: "~15 minutes" for invoice pdf links, minted fresh per read. */
export const INVOICE_PDF_URL_EXPIRY_SECONDS = 15 * 60;

/**
 * Checkout — routing + server-derived money + the order row + idempotency.
 *
 * The gateway `createOrder` here is the ONE sanctioned synchronous external
 * call in the API process (worker-and-external-sends): the user is waiting at
 * checkout. Orders leave this unit CREATED — **S5-B2's verified webhooks are
 * the ONLY thing that will ever flip them**; no client callback, no code in
 * this unit.
 *
 * PCI scope: no card data exists anywhere here — both gateways use hosted UIs.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly employerService: EmployerService,
    private readonly settings: SettingsService,
    private readonly routing: RoutingService,
    private readonly audit: AuditService,
    // S7-B1: presigns invoice pdfKeys on the list read (R2Module is @Global).
    private readonly storage: StorageService,
    @Inject(RAZORPAY_GATEWAY) private readonly razorpay: PaymentGatewayPort,
    @Inject(STRIPE_GATEWAY) private readonly stripe: PaymentGatewayPort,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ── POST /billing/checkout ───────────────────────────────────────────────────

  async checkout(
    userId: string,
    planCode: string,
    idempotencyKey: string | undefined,
    actorRole: UserRole,
  ): Promise<CheckoutSessionDto> {
    // 1. Resolve the company (B4) + approval gate (403 EMPLOYER_NOT_APPROVED).
    const company = await this.employerService.getCompanyForEmployerUser(userId);
    await this.employerService.assertApproved(company.id);

    // 2. Idempotency replay — BEFORE any validation work. A seen key returns
    //    the CACHED CheckoutSession byte-for-byte: no new order, no second
    //    gateway call. The key is scoped per company so keys can't collide
    //    (or be replayed) across tenants.
    const redisKey = idempotencyKey ? `idem:checkout:${company.id}:${idempotencyKey}` : null;
    if (redisKey) {
      const cached = await this.redis.get(redisKey);
      if (cached) return JSON.parse(cached) as CheckoutSessionDto;
    }

    // 3. Plan gate: FREE (price 0) or an inactive plan is not purchasable.
    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan || !plan.isActive || plan.priceSubunits === 0) {
      throw new UnprocessableEntityException({ code: 'PLAN_NOT_PURCHASABLE' });
    }

    // 4. Renewal/conflict rule (RENEWAL_WINDOW_DAYS): an ACTIVE same-plan
    //    subscription NOT within the window → 409. GRACE/EXPIRED → allowed
    //    (that IS the renewal path). A different plan (upgrade) → allowed.
    await this.assertRenewalAllowed(company.id, plan);

    // 5. Money — ALL server-derived: plan price from the DB, GST rate from
    //    Settings, split computed in integer subunits. Nothing about money
    //    ever arrives from the client.
    const gstRatePct = await this.settings.get(SETTING_KEYS.GST_RATE_PCT);
    const totals = computeTotals(plan.priceSubunits, company.type, gstRatePct);

    // 6. Route (sealed server-side) + create the order row FIRST so the
    //    gateway receipt carries our order id.
    const decision = await this.routing.resolveGateway(company.type);
    const order = await this.prisma.order.create({
      data: {
        companyId: company.id,
        planId: plan.id,
        gateway: decision.gateway,
        amountSubunits: totals.amountSubunits,
        gstSubunits: totals.gstSubunits,
        totalSubunits: totals.totalSubunits,
        currency: 'INR',
        status: OrderStatus.CREATED,
      },
    });

    // 7. The one sanctioned synchronous external call.
    const adapter = decision.gateway === Gateway.STRIPE ? this.stripe : this.razorpay;
    let ref;
    try {
      ref = await adapter.createOrder({
        orderId: order.id,
        totalSubunits: totals.totalSubunits,
        currency: 'INR',
        planName: plan.name,
      });
    } catch (err) {
      // Adapter failure: mark the order FAILED (it never reached the gateway
      // usably), audit, respond 502-class. The idempotency key is NOT
      // consumed (we only cache on success), so the client may retry with
      // the SAME key and succeed — the retry takes the whole path again and
      // creates a fresh order.
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.FAILED },
      });
      const msg = describeGatewayError(err);
      this.logger.error(`Gateway createOrder failed (orderId=${order.id}): ${msg}`);
      await this.audit.log({
        actorUserId: userId,
        actorRole,
        action: AUDIT_ACTIONS.CHECKOUT_FAILED,
        module: AUDIT_MODULES.PAYMENTS,
        targetType: 'Order',
        targetId: order.id,
        status: AuditStatus.FAILED,
        meta: { planCode: plan.code, gateway: decision.gateway },
      });
      throw new BadGatewayException({ code: 'GATEWAY_ERROR' });
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { gatewayOrderId: ref.gatewayOrderId },
    });

    // 8. The frozen CheckoutSession — EXACTLY ONE gateway block, matching
    //    `gateway`. (humanOrderRef is optional in the contract and the orders
    //    table carries no such column yet — deliberately omitted.)
    const session: CheckoutSessionDto = {
      orderId: order.id,
      gateway: decision.gateway,
      amountSubunits: totals.amountSubunits,
      gstSubunits: totals.gstSubunits,
      totalSubunits: totals.totalSubunits,
      currency: 'INR',
      ...(decision.gateway === Gateway.RAZORPAY
        ? { razorpay: { keyId: ref.keyId ?? '', gatewayOrderId: ref.gatewayOrderId } }
        : { stripe: { redirectUrl: ref.redirectUrl ?? '' } }),
    };

    // 9. Cache the SERIALIZED session against the idempotency key (24 h).
    //    NX: first-writer-wins — even under a concurrent same-key race the
    //    replayed response stays byte-identical to whichever succeeded first.
    if (redisKey) {
      await this.redis.set(redisKey, JSON.stringify(session), 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
    }

    // 10. Audit — ids + subunits only. No card data exists in this codebase
    //     (gateway-hosted payment UIs) and no PII belongs in audit meta.
    await this.audit.log({
      actorUserId: userId,
      actorRole,
      action: AUDIT_ACTIONS.CHECKOUT_CREATED,
      module: AUDIT_MODULES.PAYMENTS,
      targetType: 'Order',
      targetId: order.id,
      status: AuditStatus.SUCCESS,
      meta: {
        planCode: plan.code,
        gateway: decision.gateway,
        ...(decision.mode && { mode: decision.mode }),
        amountSubunits: totals.amountSubunits,
        gstSubunits: totals.gstSubunits,
        totalSubunits: totals.totalSubunits,
      },
    });

    return session;
  }

  /**
   * The stated renewal rule: 409 SUBSCRIPTION_ALREADY_ACTIVE iff the newest
   * subscription is ACTIVE, on the SAME plan, and expiry is further out than
   * RENEWAL_WINDOW_DAYS. Everything else proceeds:
   *  - inside the window → renewal (extends the term at B2 activation),
   *  - GRACE / EXPIRED → renewal,
   *  - a different paid plan → upgrade,
   *  - a FREE subscription row → upgrade.
   */
  private async assertRenewalAllowed(companyId: string, plan: Plan): Promise<void> {
    const current = await this.prisma.subscription.findFirst({
      where: { companyId },
      orderBy: { startsAt: 'desc' },
      include: { plan: true },
    });
    if (!current || current.plan.code !== plan.code || current.status !== 'ACTIVE') return;

    // Same plan, ACTIVE: allowed only inside the renewal window. A paid plan
    // without an expiry can never enter the window (defensive — seed/B2 always
    // set expiresAt on paid plans).
    const withinWindow =
      current.expiresAt !== null &&
      current.expiresAt.getTime() - Date.now() <= RENEWAL_WINDOW_DAYS * DAY_MS;
    if (!withinWindow) {
      throw new ConflictException({ code: 'SUBSCRIPTION_ALREADY_ACTIVE' });
    }
  }

  // ── GET /billing/invoices (S7-B1 — the S5 contract's endpoint, now real) ────

  /**
   * The company's invoices, newest first, offset-paginated. `pdfUrl` is a
   * SHORT-EXPIRY (15 min) signed url minted fresh per read from the row's
   * pdfKey — null until the worker has rendered the PDF (S5-F2's UI is
   * null-safe by design). The S5 contract specified this endpoint; the S7-B1
   * pass found it was never implemented — wired here alongside the pdfKey
   * population it exists to serve.
   */
  async listInvoices(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{
    data: InvoiceDto[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);
    const where = { order: { companyId: company.id } };
    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: { order: { include: { plan: true } } },
        orderBy: { issuedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    const data = await Promise.all(
      rows.map(async (inv) => ({
        id: inv.id,
        number: inv.number,
        issuedAt: inv.issuedAt.toISOString(),
        totalSubunits: inv.order.totalSubunits,
        currency: inv.order.currency,
        planName: inv.order.plan.name,
        pdfUrl: inv.pdfKey
          ? await this.storage.presignGet(inv.pdfKey, INVOICE_PDF_URL_EXPIRY_SECONDS)
          : null,
      })),
    );

    return {
      data,
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  // ── GET /billing/plans ───────────────────────────────────────────────────────

  async getPlans(): Promise<BillingPlanDto[]> {
    const [plans, gstRatePct] = await Promise.all([
      this.prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceSubunits: 'asc' } }),
      this.settings.get(SETTING_KEYS.GST_RATE_PCT),
    ]);
    return plans.map((p) => this.toPlanDto(p, gstRatePct));
  }

  // ── GET /billing/subscription ────────────────────────────────────────────────

  /**
   * ALWAYS well-formed: a company with no subscription row (or only a FREE
   * row) gets the FREE state — plan FREE, status ACTIVE, expiresAt null —
   * never a 404.
   */
  async getSubscription(userId: string): Promise<SubscriptionStatusDto> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);
    const gstRatePct = await this.settings.get(SETTING_KEYS.GST_RATE_PCT);

    const current = await this.prisma.subscription.findFirst({
      where: { companyId: company.id },
      orderBy: { startsAt: 'desc' },
      include: { plan: true },
    });

    if (!current || current.plan.code === 'FREE') {
      const freePlan =
        current?.plan ?? (await this.prisma.plan.findUniqueOrThrow({ where: { code: 'FREE' } }));
      return {
        plan: this.toPlanDto(freePlan, gstRatePct),
        status: 'ACTIVE',
        startsAt: current?.startsAt.toISOString() ?? company.createdAt.toISOString(),
        expiresAt: null,
        graceEndsAt: null,
        daysRemaining: null,
        renewable: false, // nothing to renew — a purchase is an upgrade
      };
    }

    const daysRemaining =
      current.status === 'GRACE' && current.graceEndsAt
        ? this.wholeDaysUntil(current.graceEndsAt)
        : current.status === 'EXPIRED'
          ? 0
          : current.expiresAt
            ? this.wholeDaysUntil(current.expiresAt)
            : null;

    const renewable =
      current.status !== 'ACTIVE' ||
      (current.expiresAt !== null &&
        current.expiresAt.getTime() - Date.now() <= RENEWAL_WINDOW_DAYS * DAY_MS);

    return {
      plan: this.toPlanDto(current.plan, gstRatePct),
      status: current.status,
      startsAt: current.startsAt.toISOString(),
      expiresAt: current.expiresAt?.toISOString() ?? null,
      graceEndsAt: current.graceEndsAt?.toISOString() ?? null,
      daysRemaining,
      renewable,
    };
  }

  // ── GET /billing/orders/{id} ─────────────────────────────────────────────────

  /**
   * The poll target. Own-company scoping: an order that doesn't exist and
   * another company's order return the SAME 404 (indistinguishable). Reading
   * never mutates — until B2's webhooks exist every order polls CREATED
   * forever, which is correct.
   */
  async getOrder(userId: string, orderId: string): Promise<OrderDto> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId: company.id },
      include: { plan: true, subscription: true, invoice: true },
    });
    if (!order) throw new NotFoundException({ code: 'NOT_FOUND' });

    return {
      id: order.id,
      planCode: order.plan.code,
      status: order.status,
      gateway: order.gateway,
      amountSubunits: order.amountSubunits,
      gstSubunits: order.gstSubunits,
      totalSubunits: order.totalSubunits,
      currency: order.currency,
      createdAt: order.createdAt.toISOString(),
      // B2 stamps these atomically when the verified webhook flips the order.
      subscriptionActivatedAt: order.subscription?.createdAt.toISOString() ?? null,
      invoiceId: order.invoice?.id ?? null,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private toPlanDto(plan: Plan, gstRatePct: number): BillingPlanDto {
    return {
      code: plan.code,
      name: plan.name,
      priceSubunits: plan.priceSubunits,
      // The plans table is INR-denominated (both gateways charge INR at MVP).
      currency: 'INR',
      period: plan.period === PlanPeriod.FOREVER ? null : plan.period,
      maxActiveJobs: plan.maxActiveJobs,
      gstRatePct,
      features: Array.isArray(plan.features) ? (plan.features as string[]) : [],
    };
  }

  private wholeDaysUntil(date: Date): number {
    return Math.max(0, Math.ceil((date.getTime() - Date.now()) / DAY_MS));
  }
}

/**
 * Renders a gateway failure into something an operator can act on.
 *
 * The Razorpay SDK rejects with a PLAIN OBJECT, not an Error — shaped roughly
 * `{ statusCode, error: { code, description, reason, field, source, step } }`.
 * `String(err)` on that yields the literal "[object Object]", which is what the
 * production logs were reporting: a failure with no cause, indistinguishable
 * between bad credentials, a disabled account, and a rejected amount.
 *
 * Only the provider's own diagnostic fields are surfaced. Credentials live in
 * the adapter's client config and are never part of an error body, so there is
 * nothing secret to redact here.
 */
export function describeGatewayError(err: unknown): string {
  if (err instanceof Error) return err.message;

  if (err && typeof err === 'object') {
    const outer = err as { statusCode?: unknown; error?: unknown };
    const inner = (outer.error ?? {}) as Record<string, unknown>;
    const parts = [
      outer.statusCode !== undefined ? `status=${String(outer.statusCode)}` : null,
      inner['code'] ? `code=${String(inner['code'])}` : null,
      inner['description'] ? `description=${String(inner['description'])}` : null,
      inner['reason'] ? `reason=${String(inner['reason'])}` : null,
      inner['field'] ? `field=${String(inner['field'])}` : null,
    ].filter(Boolean);

    if (parts.length > 0) return parts.join(' ');

    try {
      return JSON.stringify(err);
    } catch {
      // Circular or otherwise unserialisable — fall through.
    }
  }

  return String(err);
}

// Re-export for consumers/tests that need the order type without Prisma import.
export type { Order };
