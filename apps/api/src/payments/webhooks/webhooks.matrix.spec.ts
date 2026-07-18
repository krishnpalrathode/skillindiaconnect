/**
 * The Phase-5 §5 webhook matrix — BOTH gateways, real Postgres
 * (Testcontainers), REAL adapters with GENUINELY SIGNED fixtures (Razorpay:
 * real HMAC-SHA256 over the raw bytes; Stripe: the SDK's own
 * generateTestHeaderString → constructEvent verification). Stubbing
 * verification here would test nothing — the whole unit IS the verification.
 *
 * Audit rows are written by the REAL AuditService into the container DB and
 * asserted from audit_logs. Notifications are stubbed at the NotificationService
 * boundary (the queue/worker owns delivery; this unit only asserts the enqueue).
 *
 * Skips gracefully when Docker is unavailable (mirrors checkout.service.spec).
 */
import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CompanyStatus,
  CompanyType,
  Gateway,
  OrderStatus,
  PlanPeriod,
  PrismaClient,
  SubscriptionStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import * as path from 'path';
import Stripe from 'stripe';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { EmployerService } from '../../employer/employer.service';
import { NotificationService } from '../../notifications/notification.service';
import { RazorpayAdapter } from '../gateways/razorpay.adapter';
import { StripeAdapter } from '../gateways/stripe.adapter';
import { InvoiceService } from '../invoice.service';
import { ActivationService } from '../activation.service';
import { PaymentEventsHandler } from './handlers/payment-events.handler';
import { WebhookService } from './webhook.service';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../../..');
const DAY_MS = 24 * 60 * 60 * 1000;

const RZP_WEBHOOK_SECRET = 'rzp_whsec_matrix_test';
const STRIPE_WEBHOOK_SECRET = 'whsec_matrix_test';

let pg: StartedTestContainer;
let prisma: PrismaClient;
let service: WebhookService;
let notifySpy: jest.Mock;
let dockerUnavailable = false;

let companyId: string;
let proMonthlyId: string;

// ── Signed-payload helpers (REAL signatures) ──────────────────────────────────

let seq = 0;
const uid = (p: string) => `${p}_${Date.now()}_${++seq}`;

function rzpBody(
  type: string,
  o: { orderId?: string; gatewayOrderId?: string; paymentId?: string },
): Buffer {
  return Buffer.from(
    JSON.stringify({
      event: type,
      payload: {
        payment: {
          entity: {
            id: o.paymentId ?? uid('pay'),
            order_id: o.gatewayOrderId ?? uid('order'),
            notes: o.orderId ? { orderId: o.orderId } : {},
          },
        },
      },
    }),
  );
}

function rzpHeaders(body: Buffer, eventId: string): Record<string, string> {
  return {
    'x-razorpay-signature': createHmac('sha256', RZP_WEBHOOK_SECRET).update(body).digest('hex'),
    'x-razorpay-event-id': eventId,
  };
}

const stripeSigner = new Stripe('sk_test_dummy');
function stripeBody(
  type: string,
  o: { eventId: string; orderId?: string; sessionId?: string; paymentIntent?: string },
): Buffer {
  return Buffer.from(
    JSON.stringify({
      id: o.eventId,
      type,
      data: {
        object: {
          id: o.sessionId ?? uid('cs'),
          object: 'checkout.session',
          metadata: o.orderId ? { orderId: o.orderId } : {},
          payment_intent: o.paymentIntent ?? uid('pi'),
        },
      },
    }),
  );
}

function stripeHeaders(body: Buffer): Record<string, string> {
  return {
    'stripe-signature': stripeSigner.webhooks.generateTestHeaderString({
      payload: body.toString('utf8'),
      secret: STRIPE_WEBHOOK_SECRET,
    }),
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function mkOrder(
  opts: { gateway?: Gateway; status?: OrderStatus; planId?: string } = {},
): Promise<{ id: string; gatewayOrderId: string }> {
  const gatewayOrderId = uid('gwo');
  const order = await prisma.order.create({
    data: {
      companyId,
      planId: opts.planId ?? proMonthlyId,
      gateway: opts.gateway ?? Gateway.RAZORPAY,
      amountSubunits: 299_900,
      gstSubunits: 53_982,
      totalSubunits: 353_882,
      currency: 'INR',
      status: opts.status ?? OrderStatus.CREATED,
      gatewayOrderId,
    },
  });
  return { id: order.id, gatewayOrderId };
}

const auditCount = (action: string) => prisma.auditLog.count({ where: { action } });

beforeAll(async () => {
  try {
    pg = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_USER: 'sic', POSTGRES_PASSWORD: 'sic', POSTGRES_DB: 'sic_webhooks' })
      .withExposedPorts(5432)
      .start();
    const url = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_webhooks`;
    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();

    proMonthlyId = (
      await prisma.plan.create({
        data: { code: 'PRO_MONTHLY', name: 'Pro Monthly', priceSubunits: 299_900, period: PlanPeriod.MONTHLY, features: [] },
      })
    ).id;
    await prisma.plan.create({
      data: { code: 'PRO_YEARLY', name: 'Pro Yearly', priceSubunits: 2_499_900, period: PlanPeriod.YEARLY, features: [] },
    });
    companyId = (
      await prisma.company.create({
        data: {
          name: 'Webhook Co',
          type: CompanyType.FOREIGN,
          status: CompanyStatus.APPROVED,
          registrationNumber: 'WH-1',
          industryType: 'Construction',
          phone: '+91100',
          location: 'Dubai',
          employeeRange: '10-50',
        },
      })
    ).id;

    // Real services against the container; the queue boundary stubbed.
    const prismaSvc = prisma as unknown as PrismaService;
    const audit = new AuditService(prismaSvc);
    const config = {
      get: (k: string) =>
        ({
          RAZORPAY_KEY_ID: 'rzp_test_matrix',
          RAZORPAY_KEY_SECRET: 'matrix_secret',
          RAZORPAY_WEBHOOK_SECRET: RZP_WEBHOOK_SECRET,
          STRIPE_SECRET_KEY: 'sk_test_dummy',
          STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK_SECRET,
          WEB_APP_URL: 'http://localhost:3000',
        })[k],
    } as unknown as ConfigService;
    const razorpay = new RazorpayAdapter(config);
    const stripe = new StripeAdapter(config);

    notifySpy = jest.fn().mockResolvedValue(undefined);
    const notifications = { notify: notifySpy } as unknown as NotificationService;
    const employer = {
      getPrimaryUserIdForCompany: jest.fn().mockResolvedValue('wh-emp-user-1'),
    } as unknown as EmployerService;

    const activation = new ActivationService(
      prismaSvc,
      new InvoiceService(),
      employer,
      notifications,
      audit,
      new EventEmitter2(),
      // S7-B1: the post-commit invoice-render enqueue — inert here.
      { add: jest.fn().mockResolvedValue(undefined) } as never,
    );
    const handler = new PaymentEventsHandler(prismaSvc, activation, audit);
    service = new WebhookService(prismaSvc, handler, audit, razorpay, stripe);
  } catch {
    dockerUnavailable = true;
    // eslint-disable-next-line no-console
    console.warn('Docker unavailable — skipping webhook matrix tests.');
  }
});

afterAll(async () => {
  if (dockerUnavailable) return;
  await prisma.$disconnect();
  await pg.stop();
});

const gatedIt = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (dockerUnavailable) return;
    await fn();
  });

beforeEach(() => {
  if (!dockerUnavailable) jest.clearAllMocks();
});

// ── Valid activations, both gateways ─────────────────────────────────────────

describe('valid signed success events', () => {
  gatedIt('razorpay: 200 → PAID + ACTIVE sub + sequential invoice + payments row + notification + audits', async () => {
    const { id: orderId } = await mkOrder();
    const payId = uid('pay');
    const body = rzpBody('payment.captured', { orderId, paymentId: payId });

    await service.process('razorpay', body, rzpHeaders(body, uid('evt')));

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { subscription: true, invoice: true, payments: true },
    });
    expect(order.status).toBe(OrderStatus.PAID);
    expect(order.subscription?.status).toBe(SubscriptionStatus.ACTIVE);
    expect(order.invoice?.number).toMatch(/^SIC-\d{4}-\d{5}$/);
    expect(order.invoice?.pdfKey).toBeNull(); // rendering deferred to S7
    expect(order.payments).toHaveLength(1);
    expect(order.payments[0]!.gatewayPaymentId).toBe(payId);
    expect(notifySpy).toHaveBeenCalledWith(
      'wh-emp-user-1',
      'SUBSCRIPTION_PURCHASED',
      expect.objectContaining({ title: expect.any(String) }),
    );
    expect(await auditCount('payment.captured')).toBeGreaterThanOrEqual(1);
    expect(await auditCount('subscription.activated')).toBeGreaterThanOrEqual(1);
  });

  gatedIt('stripe: checkout.session.completed via constructEvent-verified signature activates identically', async () => {
    const { id: orderId } = await mkOrder({ gateway: Gateway.STRIPE });
    const body = stripeBody('checkout.session.completed', { eventId: uid('evt'), orderId });

    await service.process('stripe', body, stripeHeaders(body));

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { subscription: true, invoice: true },
    });
    expect(order.status).toBe(OrderStatus.PAID);
    expect(order.subscription?.status).toBe(SubscriptionStatus.ACTIVE);
    expect(order.invoice).not.toBeNull();
  });
});

// ── Signature failure ─────────────────────────────────────────────────────────

describe('signature failure — verify BEFORE parse', () => {
  gatedIt('tampered body → 401, JSON.parse never ran, zero rows, FAILED audit', async () => {
    const { id: orderId } = await mkOrder();
    const body = rzpBody('payment.captured', { orderId });
    const headers = rzpHeaders(body, uid('evt'));
    const tampered = Buffer.from(body.toString('utf8').replace('captured', 'captureX'));

    const parseSpy = jest.spyOn(JSON, 'parse');
    const before = await prisma.webhookEvent.count();
    try {
      await expect(service.process('razorpay', tampered, headers)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // The tampered body was NEVER parsed — verification runs on raw bytes first.
      const tamperedStr = tampered.toString('utf8');
      expect(parseSpy.mock.calls.some(([arg]) => arg === tamperedStr)).toBe(false);
    } finally {
      parseSpy.mockRestore();
    }

    expect(await prisma.webhookEvent.count()).toBe(before); // no dedupe row
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      OrderStatus.CREATED, // no state change
    );
    const rejected = await prisma.auditLog.findFirst({
      where: { action: 'webhook.rejected' },
      orderBy: { createdAt: 'desc' },
    });
    expect(rejected?.status).toBe('FAILED');
    expect(JSON.stringify(rejected?.meta)).not.toContain('captureX'); // never the payload
  });

  gatedIt('stripe: wrong secret → 401', async () => {
    const body = stripeBody('checkout.session.completed', { eventId: uid('evt') });
    const badSig = new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({
      payload: body.toString('utf8'),
      secret: 'whsec_WRONG',
    });
    await expect(
      service.process('stripe', body, { 'stripe-signature': badSig }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

// ── Replay + duplicates + concurrency ────────────────────────────────────────

describe('dedupe, duplicates, and concurrency', () => {
  gatedIt('the identical event twice → one activation, one invoice, webhook.duplicate audit', async () => {
    const { id: orderId } = await mkOrder();
    const eventId = uid('evt');
    const body = rzpBody('payment.captured', { orderId });
    const headers = rzpHeaders(body, eventId);

    await service.process('razorpay', body, headers);
    const dupesBefore = await auditCount('webhook.duplicate');
    await service.process('razorpay', body, headers); // the replay — resolves 200-path

    expect(await auditCount('webhook.duplicate')).toBe(dupesBefore + 1);
    expect(await prisma.invoice.count({ where: { orderId } })).toBe(1);
    expect(await prisma.subscription.count({ where: { orderId } })).toBe(1);
    expect(
      await prisma.webhookEvent.count({ where: { provider: 'razorpay', eventId } }),
    ).toBe(1);
  });

  gatedIt('two DISTINCT success events for one order → one activation, one invoice (state re-check under lock)', async () => {
    const { id: orderId } = await mkOrder();
    const b1 = rzpBody('payment.captured', { orderId });
    const b2 = rzpBody('order.paid', { orderId });

    await service.process('razorpay', b1, rzpHeaders(b1, uid('evt')));
    await service.process('razorpay', b2, rzpHeaders(b2, uid('evt')));

    expect(await prisma.invoice.count({ where: { orderId } })).toBe(1);
    expect(await auditCount('webhook.noop')).toBeGreaterThanOrEqual(1);
  });

  gatedIt('CONCURRENT delivery: two parallel success posts → exactly one PAID transition, one sub, one invoice', async () => {
    const { id: orderId } = await mkOrder();
    const b1 = rzpBody('payment.captured', { orderId });
    const b2 = rzpBody('payment.captured', { orderId, paymentId: uid('pay') });

    await Promise.all([
      service.process('razorpay', b1, rzpHeaders(b1, uid('evt'))),
      service.process('razorpay', b2, rzpHeaders(b2, uid('evt'))),
    ]);

    expect(await prisma.invoice.count({ where: { orderId } })).toBe(1); // FOR UPDATE proven
    expect(await prisma.subscription.count({ where: { orderId } })).toBe(1);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status,
    ).toBe(OrderStatus.PAID);
  });

  gatedIt('invoice sequence under concurrency: N parallel activations → N distinct sequential numbers', async () => {
    // Fresh companies so the renewal path doesn't serialize them onto one sub.
    const orders = await Promise.all(
      [0, 1, 2].map(async () => {
        const c = await prisma.company.create({
          data: {
            name: uid('SeqCo'),
            type: CompanyType.FOREIGN,
            status: CompanyStatus.APPROVED,
            registrationNumber: uid('SEQ'),
            industryType: 'Construction',
            phone: '+91100',
            location: 'Dubai',
            employeeRange: '10-50',
          },
        });
        return prisma.order.create({
          data: {
            companyId: c.id,
            planId: proMonthlyId,
            gateway: Gateway.RAZORPAY,
            amountSubunits: 299_900,
            gstSubunits: 0,
            totalSubunits: 299_900,
            currency: 'INR',
            status: OrderStatus.CREATED,
            gatewayOrderId: uid('gwo'),
          },
        });
      }),
    );

    await Promise.all(
      orders.map((o) => {
        const b = rzpBody('payment.captured', { orderId: o.id });
        return service.process('razorpay', b, rzpHeaders(b, uid('evt')));
      }),
    );

    const invoices = await prisma.invoice.findMany({
      where: { orderId: { in: orders.map((o) => o.id) } },
    });
    expect(invoices).toHaveLength(3);
    const nums = invoices.map((i) => Number(i.number.split('-')[2])).sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(3); // the sequence never hands out a collision
    // Consecutive within this burst (no rollbacks ran between them); gaps
    // from rolled-back transactions elsewhere are inherent to sequences.
    expect(nums[2]! - nums[0]!).toBe(2);
  });
});

// ── Out-of-order + refunds ───────────────────────────────────────────────────

describe('out-of-order reconciliation (state, never sequence)', () => {
  gatedIt('failure AFTER success → order stays PAID + stale_ignored audit', async () => {
    const { id: orderId } = await mkOrder();
    const ok = rzpBody('payment.captured', { orderId });
    await service.process('razorpay', ok, rzpHeaders(ok, uid('evt')));

    const fail = rzpBody('payment.failed', { orderId });
    await service.process('razorpay', fail, rzpHeaders(fail, uid('evt')));

    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      OrderStatus.PAID, // a failure event must never regress a paid order
    );
    expect(await auditCount('webhook.stale_ignored')).toBeGreaterThanOrEqual(1);
  });

  gatedIt('failure on CREATED marks FAILED; a success arriving AFTER (late capture) ACTIVATES — the money is real', async () => {
    const { id: orderId } = await mkOrder();
    const fail = rzpBody('payment.failed', { orderId });
    await service.process('razorpay', fail, rzpHeaders(fail, uid('evt')));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      OrderStatus.FAILED,
    );

    const late = rzpBody('payment.captured', { orderId });
    await service.process('razorpay', late, rzpHeaders(late, uid('evt')));

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { invoice: true },
    });
    expect(order.status).toBe(OrderStatus.PAID); // the stated late-capture choice
    expect(order.invoice).not.toBeNull();
    const captured = await prisma.auditLog.findFirst({
      where: { action: 'payment.captured', targetId: orderId },
    });
    expect((captured?.meta as { lateCapture?: boolean })?.lateCapture).toBe(true); // flagged for ops
  });

  gatedIt('refund on PAID → REFUNDED + audit (no clawback beyond the flag at MVP)', async () => {
    const { id: orderId } = await mkOrder();
    const ok = rzpBody('payment.captured', { orderId });
    await service.process('razorpay', ok, rzpHeaders(ok, uid('evt')));

    const refund = Buffer.from(
      JSON.stringify({
        event: 'refund.processed',
        payload: { refund: { entity: { id: uid('rfnd'), payment_id: uid('pay'), notes: { orderId } } } },
      }),
    );
    await service.process('razorpay', refund, rzpHeaders(refund, uid('evt')));

    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      OrderStatus.REFUNDED,
    );
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'payment.refunded', targetId: orderId },
    });
    expect((audit?.meta as { clawback?: string })?.clawback).toBe('manual-ops-review');
  });
});

// ── Unknown order + renewal extension ────────────────────────────────────────

describe('unknown orders and renewal', () => {
  gatedIt('signed event for no matching order → resolves (200 path) + unknown_order audit — no existence leak', async () => {
    const body = rzpBody('payment.captured', {
      orderId: '00000000-0000-4000-8000-00000000dead',
      gatewayOrderId: uid('ghost'),
    });
    await expect(
      service.process('razorpay', body, rzpHeaders(body, uid('evt'))),
    ).resolves.toBeUndefined();
    expect(await auditCount('webhook.unknown_order')).toBeGreaterThanOrEqual(1);
  });

  gatedIt('renewal: activating a second order for an ACTIVE sub EXTENDS from current expiry, not from now', async () => {
    // First activation → a fresh 30-day term.
    const first = await mkOrder();
    const b1 = rzpBody('payment.captured', { orderId: first.id });
    await service.process('razorpay', b1, rzpHeaders(b1, uid('evt')));
    const sub1 = await prisma.subscription.findUniqueOrThrow({ where: { orderId: first.id } });
    const firstExpiry = sub1.expiresAt!.getTime();

    // Renewal (same plan, same company) → same row, expiry = FIRST EXPIRY + 30d.
    const second = await mkOrder();
    const b2 = rzpBody('payment.captured', { orderId: second.id });
    await service.process('razorpay', b2, rzpHeaders(b2, uid('evt')));

    const renewed = await prisma.subscription.findUniqueOrThrow({ where: { id: sub1.id } });
    expect(renewed.orderId).toBe(second.id); // the row points at the latest paying order
    expect(renewed.status).toBe(SubscriptionStatus.ACTIVE);
    expect(renewed.graceEndsAt).toBeNull();
    // Extended from the CURRENT expiry (paid time never lost) — not from now.
    expect(renewed.expiresAt!.getTime()).toBe(firstExpiry + 30 * DAY_MS);
    // Still ONE subscription row for the company (extension, not stacking).
    expect(await prisma.subscription.count({ where: { companyId } })).toBe(1);
  });
});
