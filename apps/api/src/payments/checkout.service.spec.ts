/**
 * CheckoutService integration spec — real Postgres (Testcontainers), fake
 * Redis (in-memory, NX-faithful), gateway ports mocked AT THE SDK BOUNDARY
 * (the adapters themselves get a gated live smoke in razorpay.adapter.spec).
 *
 * Proves: server-derived money + routing, ONE order per idempotency key with
 * a byte-same replayed response, the renewal-window rule on both sides, the
 * error ladder (403/422/409), adapter-failure semantics (FAILED order + the
 * key NOT consumed → a same-key retry succeeds), and the reads (FREE-state
 * shape, own-company 404, the eternal-CREATED poll).
 *
 * Skips gracefully when Docker is unavailable (mirrors apply-gate.service.spec).
 */
import { ForbiddenException } from '@nestjs/common';
import {
  CompanyStatus,
  CompanyType,
  Gateway,
  OrderStatus,
  PlanPeriod,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { execSync } from 'child_process';
import * as path from 'path';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { Redis } from 'ioredis';
import { PrismaService } from '../core/prisma/prisma.service';
import { EmployerService } from '../employer/employer.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { CheckoutService, RENEWAL_WINDOW_DAYS } from './checkout.service';
import { RoutingService } from './routing.service';
import { PaymentGatewayPort } from './gateways/payment-gateway.interface';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');
const DAY_MS = 24 * 60 * 60 * 1000;

let pg: StartedTestContainer;
let prisma: PrismaClient;
let service: CheckoutService;
let dockerUnavailable = false;

// ── Fakes ─────────────────────────────────────────────────────────────────────

/** NX-faithful in-memory Redis — only the calls CheckoutService makes. */
class FakeRedis {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, ...args: unknown[]): Promise<'OK' | null> {
    if (args.includes('NX') && this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }
}

function fakePort(): PaymentGatewayPort & { createOrder: jest.Mock } {
  let n = 0;
  return {
    isConfigured: true,
    createOrder: jest.fn().mockImplementation(async () => ({
      gatewayOrderId: `order_test_${++n}_${Date.now()}`,
      keyId: 'rzp_test_key',
      redirectUrl: 'https://checkout.stripe.com/c/pay/test',
    })),
    verifyWebhook: jest.fn(),
    parseEvent: jest.fn(),
  };
}

// Mutable settings the tests flip (gst rate + the stripe routing flag).
const settingsState = { gstRatePct: 18, stripeEnabled: false };
const settingsStub = {
  get: jest.fn().mockImplementation(async (def: { key: string }) =>
    def.key === 'payments.gst_rate_pct' ? settingsState.gstRatePct : settingsState.stripeEnabled,
  ),
} as unknown as SettingsService;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const LOCAL_USER = 'co-user-local';
const FOREIGN_USER = 'co-user-foreign';
const PENDING_USER = 'co-user-pending';
let localCompanyId: string;
let foreignCompanyId: string;
let pendingCompanyId: string;
let proMonthlyId: string;
let redis: FakeRedis;
let razorpayPort: ReturnType<typeof fakePort>;
let stripePort: ReturnType<typeof fakePort>;
const auditLog = jest.fn().mockResolvedValue(undefined);

beforeAll(async () => {
  try {
    pg = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_USER: 'sic', POSTGRES_PASSWORD: 'sic', POSTGRES_DB: 'sic_checkout' })
      .withExposedPorts(5432)
      .start();

    const url = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_checkout`;
    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });

    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();

    // Plans (the seeded three + an inactive one for the 422 branch).
    const mkPlan = (code: string, price: number, period: PlanPeriod, isActive = true) =>
      prisma.plan.create({
        data: { code, name: code, priceSubunits: price, period, features: [], isActive },
      });
    await mkPlan('FREE', 0, PlanPeriod.FOREVER);
    proMonthlyId = (await mkPlan('PRO_MONTHLY', 299_900, PlanPeriod.MONTHLY)).id;
    await mkPlan('PRO_YEARLY', 2_499_900, PlanPeriod.YEARLY);
    await mkPlan('LEGACY_PLAN', 100_000, PlanPeriod.MONTHLY, false);

    // Companies: LOCAL approved, FOREIGN approved, LOCAL pending.
    const mkCompany = (name: string, type: CompanyType, status: CompanyStatus) =>
      prisma.company.create({
        data: {
          name,
          type,
          status,
          registrationNumber: `REG-${name}`,
          industryType: 'Construction',
          phone: '+91100',
          location: type === CompanyType.LOCAL ? 'Mumbai' : 'Dubai',
          employeeRange: '10-50',
        },
      });
    localCompanyId = (await mkCompany('Local Co', CompanyType.LOCAL, CompanyStatus.APPROVED)).id;
    foreignCompanyId = (
      await mkCompany('Foreign Co', CompanyType.FOREIGN, CompanyStatus.APPROVED)
    ).id;
    pendingCompanyId = (
      await mkCompany('Pending Co', CompanyType.LOCAL, CompanyStatus.PENDING)
    ).id;
  } catch {
    dockerUnavailable = true;
    // eslint-disable-next-line no-console
    console.warn('Docker unavailable — skipping CheckoutService integration tests.');
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
  if (dockerUnavailable) return;
  jest.clearAllMocks();
  settingsState.gstRatePct = 18;
  settingsState.stripeEnabled = false;
  redis = new FakeRedis();
  razorpayPort = fakePort();
  stripePort = fakePort();

  // The employer boundary, stubbed against the REAL company rows — the spec
  // tests CheckoutService, not EmployerService (which has its own suite).
  const userToCompany: Record<string, string> = {
    [LOCAL_USER]: localCompanyId,
    [FOREIGN_USER]: foreignCompanyId,
    [PENDING_USER]: pendingCompanyId,
  };
  const employerStub = {
    getCompanyForEmployerUser: async (userId: string) =>
      prisma.company.findUniqueOrThrow({ where: { id: userToCompany[userId]! } }),
    assertApproved: async (companyId: string) => {
      const c = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
      if (c.status !== CompanyStatus.APPROVED) {
        throw new ForbiddenException({ code: 'EMPLOYER_NOT_APPROVED' });
      }
    },
  } as unknown as EmployerService;

  const routing = new RoutingService(settingsStub, razorpayPort, stripePort);
  service = new CheckoutService(
    prisma as unknown as PrismaService,
    employerStub,
    settingsStub,
    routing,
    { log: auditLog } as unknown as AuditService,
    razorpayPort,
    stripePort,
    redis as unknown as Redis,
  );
});

afterEach(async () => {
  if (dockerUnavailable) return;
  await prisma.subscription.deleteMany({});
  await prisma.order.deleteMany({});
});

// ── Happy paths: money + routing ──────────────────────────────────────────────

describe('checkout — money + routing (server-derived, sealed)', () => {
  gatedIt('LOCAL: order CREATED with the GST split; razorpay block ONLY', async () => {
    const session = await service.checkout(LOCAL_USER, 'PRO_MONTHLY', undefined, UserRole.EMPLOYER);

    expect(session.gateway).toBe(Gateway.RAZORPAY);
    expect(session.amountSubunits).toBe(299_900);
    expect(session.gstSubunits).toBe(53_982); // 18% of 299900, integer half-up
    expect(session.totalSubunits).toBe(353_882);
    expect(session.currency).toBe('INR');
    expect(session.razorpay).toBeDefined();
    expect(session.stripe).toBeUndefined(); // exactly ONE gateway block

    const order = await prisma.order.findUniqueOrThrow({ where: { id: session.orderId } });
    expect(order.status).toBe(OrderStatus.CREATED);
    expect(order.companyId).toBe(localCompanyId);
    expect(order.amountSubunits).toBe(299_900);
    expect(order.gstSubunits).toBe(53_982);
    expect(order.totalSubunits).toBe(353_882);
    expect(order.gatewayOrderId).toBe(session.razorpay!.gatewayOrderId);

    // The gateway was charged the TOTAL (amount + gst), integer subunits.
    expect(razorpayPort.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ totalSubunits: 353_882, currency: 'INR' }),
    );
  });

  gatedIt('FOREIGN: zero-rated (gst EXPLICITLY 0) via razorpay-intl by default', async () => {
    const session = await service.checkout(FOREIGN_USER, 'PRO_MONTHLY', undefined, UserRole.EMPLOYER);

    expect(session.gateway).toBe(Gateway.RAZORPAY);
    expect(session.gstSubunits).toBe(0); // zero-rated export — present, not absent
    expect(session.totalSubunits).toBe(299_900);
    expect(session.stripe).toBeUndefined();

    // The routing mode is recorded in the audit meta (INTERNATIONAL).
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'checkout.created',
        meta: expect.objectContaining({ mode: 'INTERNATIONAL', gstSubunits: 0 }),
      }),
    );
  });

  gatedIt('FOREIGN + stripe flag ON → the stripe block ONLY; flag OFF next call → razorpay again', async () => {
    settingsState.stripeEnabled = true;
    const stripeSession = await service.checkout(FOREIGN_USER, 'PRO_MONTHLY', undefined, UserRole.EMPLOYER);
    expect(stripeSession.gateway).toBe(Gateway.STRIPE);
    expect(stripeSession.stripe?.redirectUrl).toContain('stripe.com');
    expect(stripeSession.razorpay).toBeUndefined();
    expect(stripePort.createOrder).toHaveBeenCalledTimes(1);
    expect(razorpayPort.createOrder).not.toHaveBeenCalled();

    settingsState.stripeEnabled = false;
    const rzpSession = await service.checkout(FOREIGN_USER, 'PRO_YEARLY', undefined, UserRole.EMPLOYER);
    expect(rzpSession.gateway).toBe(Gateway.RAZORPAY);
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('checkout — Idempotency-Key', () => {
  gatedIt('same key twice → ONE order row, ONE adapter call, byte-same response', async () => {
    const first = await service.checkout(LOCAL_USER, 'PRO_MONTHLY', 'key-A', UserRole.EMPLOYER);
    const second = await service.checkout(LOCAL_USER, 'PRO_MONTHLY', 'key-A', UserRole.EMPLOYER);

    // Byte-same: the cached SERIALIZED session is replayed.
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(razorpayPort.createOrder).toHaveBeenCalledTimes(1);
    expect(await prisma.order.count()).toBe(1);
  });

  gatedIt('different keys → two independent orders', async () => {
    await service.checkout(LOCAL_USER, 'PRO_MONTHLY', 'key-B', UserRole.EMPLOYER);
    await service.checkout(LOCAL_USER, 'PRO_MONTHLY', 'key-C', UserRole.EMPLOYER);
    expect(await prisma.order.count()).toBe(2);
    expect(razorpayPort.createOrder).toHaveBeenCalledTimes(2);
  });

  gatedIt('no key → every call is a fresh order (idempotency is opt-in)', async () => {
    await service.checkout(LOCAL_USER, 'PRO_MONTHLY', undefined, UserRole.EMPLOYER);
    await service.checkout(LOCAL_USER, 'PRO_MONTHLY', undefined, UserRole.EMPLOYER);
    expect(await prisma.order.count()).toBe(2);
  });
});

// ── The error ladder ─────────────────────────────────────────────────────────

describe('checkout — error ladder', () => {
  gatedIt('unapproved company → 403 EMPLOYER_NOT_APPROVED, no order row', async () => {
    await expect(
      service.checkout(PENDING_USER, 'PRO_MONTHLY', undefined, UserRole.EMPLOYER),
    ).rejects.toMatchObject({ response: { code: 'EMPLOYER_NOT_APPROVED' } });
    expect(await prisma.order.count()).toBe(0);
  });

  gatedIt('FREE → 422 PLAN_NOT_PURCHASABLE; inactive plan → same; unknown code → same', async () => {
    for (const code of ['FREE', 'LEGACY_PLAN', 'NO_SUCH_PLAN']) {
      await expect(
        service.checkout(LOCAL_USER, code, undefined, UserRole.EMPLOYER),
      ).rejects.toMatchObject({ response: { code: 'PLAN_NOT_PURCHASABLE' } });
    }
    expect(await prisma.order.count()).toBe(0);
  });

  gatedIt('ACTIVE same plan OUTSIDE the renewal window → 409 SUBSCRIPTION_ALREADY_ACTIVE', async () => {
    await prisma.subscription.create({
      data: {
        companyId: localCompanyId,
        planId: proMonthlyId,
        status: 'ACTIVE',
        startsAt: new Date(Date.now() - 10 * DAY_MS),
        // Expiry comfortably beyond the window → not renewable yet.
        expiresAt: new Date(Date.now() + (RENEWAL_WINDOW_DAYS + 13) * DAY_MS),
      },
    });
    await expect(
      service.checkout(LOCAL_USER, 'PRO_MONTHLY', undefined, UserRole.EMPLOYER),
    ).rejects.toMatchObject({ response: { code: 'SUBSCRIPTION_ALREADY_ACTIVE' } });
  });

  gatedIt('ACTIVE same plan INSIDE the window (≤7d) → renewal ALLOWED (extends the term)', async () => {
    await prisma.subscription.create({
      data: {
        companyId: localCompanyId,
        planId: proMonthlyId,
        status: 'ACTIVE',
        startsAt: new Date(Date.now() - 27 * DAY_MS),
        expiresAt: new Date(Date.now() + 3 * DAY_MS), // inside RENEWAL_WINDOW_DAYS
      },
    });
    const session = await service.checkout(LOCAL_USER, 'PRO_MONTHLY', undefined, UserRole.EMPLOYER);
    expect(session.orderId).toBeDefined();
  });

  gatedIt('GRACE same plan → renewal ALLOWED; a DIFFERENT plan (upgrade) → always allowed', async () => {
    await prisma.subscription.create({
      data: {
        companyId: localCompanyId,
        planId: proMonthlyId,
        status: 'GRACE',
        startsAt: new Date(Date.now() - 33 * DAY_MS),
        expiresAt: new Date(Date.now() - 3 * DAY_MS),
        graceEndsAt: new Date(Date.now() + 4 * DAY_MS),
      },
    });
    await expect(
      service.checkout(LOCAL_USER, 'PRO_MONTHLY', undefined, UserRole.EMPLOYER),
    ).resolves.toBeDefined();

    // Different-plan upgrade even while a far-from-expiry ACTIVE sub exists:
    await prisma.subscription.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.subscription.create({
      data: {
        companyId: localCompanyId,
        planId: proMonthlyId,
        status: 'ACTIVE',
        startsAt: new Date(),
        expiresAt: new Date(Date.now() + 25 * DAY_MS),
      },
    });
    await expect(
      service.checkout(LOCAL_USER, 'PRO_YEARLY', undefined, UserRole.EMPLOYER),
    ).resolves.toBeDefined();
  });
});

// ── Adapter failure ───────────────────────────────────────────────────────────

describe('checkout — adapter failure semantics', () => {
  gatedIt('gateway failure → order FAILED + 502 GATEWAY_ERROR + audited; key NOT consumed → same-key retry succeeds', async () => {
    razorpayPort.createOrder.mockRejectedValueOnce(new Error('razorpay 5xx'));

    await expect(
      service.checkout(LOCAL_USER, 'PRO_MONTHLY', 'key-retry', UserRole.EMPLOYER),
    ).rejects.toMatchObject({ response: { code: 'GATEWAY_ERROR' } });

    const failed = await prisma.order.findMany({});
    expect(failed).toHaveLength(1);
    expect(failed[0]!.status).toBe(OrderStatus.FAILED);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'checkout.failed' }),
    );

    // The idempotency key was NOT consumed (we cache only on success) — the
    // SAME key retries into a fresh, successful order.
    const retry = await service.checkout(LOCAL_USER, 'PRO_MONTHLY', 'key-retry', UserRole.EMPLOYER);
    expect(retry.razorpay).toBeDefined();
    const orders = await prisma.order.findMany({ orderBy: { createdAt: 'asc' } });
    expect(orders).toHaveLength(2);
    expect(orders[1]!.status).toBe(OrderStatus.CREATED);

    // …and NOW the key is consumed: a third call replays the retry's session.
    const replay = await service.checkout(LOCAL_USER, 'PRO_MONTHLY', 'key-retry', UserRole.EMPLOYER);
    expect(JSON.stringify(replay)).toBe(JSON.stringify(retry));
    expect(await prisma.order.count()).toBe(2);
  });
});

// ── Reads ─────────────────────────────────────────────────────────────────────

describe('reads', () => {
  gatedIt('getSubscription with NO row → the well-formed FREE state (never 404)', async () => {
    const sub = await service.getSubscription(LOCAL_USER);
    expect(sub.plan.code).toBe('FREE');
    expect(sub.status).toBe('ACTIVE');
    expect(sub.expiresAt).toBeNull();
    expect(sub.graceEndsAt).toBeNull();
    expect(sub.daysRemaining).toBeNull();
    expect(sub.renewable).toBe(false);
    expect(sub.plan.gstRatePct).toBe(18); // the display hint rides along
  });

  gatedIt('getSubscription GRACE → graceEndsAt + daysRemaining from grace end + renewable', async () => {
    await prisma.subscription.create({
      data: {
        companyId: foreignCompanyId,
        planId: proMonthlyId,
        status: 'GRACE',
        startsAt: new Date(Date.now() - 33 * DAY_MS),
        expiresAt: new Date(Date.now() - 3 * DAY_MS),
        graceEndsAt: new Date(Date.now() + 4 * DAY_MS),
      },
    });
    const sub = await service.getSubscription(FOREIGN_USER);
    expect(sub.status).toBe('GRACE');
    expect(sub.graceEndsAt).not.toBeNull();
    expect(sub.daysRemaining).toBe(4);
    expect(sub.renewable).toBe(true);
  });

  gatedIt('getPlans → active plans only, price-ascending, with the gstRatePct hint', async () => {
    const plans = await service.getPlans();
    expect(plans.map((p) => p.code)).toEqual(['FREE', 'PRO_MONTHLY', 'PRO_YEARLY']); // no LEGACY_PLAN
    expect(plans[0]!.period).toBeNull(); // FOREVER → null per the frozen contract
    expect(plans.every((p) => p.gstRatePct === 18)).toBe(true);
    expect(plans.every((p) => Number.isSafeInteger(p.priceSubunits))).toBe(true);
  });

  gatedIt('getOrder: another company\'s order → the SAME 404 as nonexistent; own order polls CREATED forever', async () => {
    const session = await service.checkout(LOCAL_USER, 'PRO_MONTHLY', undefined, UserRole.EMPLOYER);

    // Cross-company probe (FOREIGN_USER polling LOCAL's order) → 404.
    await expect(service.getOrder(FOREIGN_USER, session.orderId)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
    // Nonexistent id → the same code (indistinguishable).
    await expect(
      service.getOrder(LOCAL_USER, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });

    // The eternal-CREATED poll: nothing in B1 can flip an order — two polls,
    // still CREATED, activation fields null (B2's webhook is the only flipper).
    for (let i = 0; i < 2; i++) {
      const order = await service.getOrder(LOCAL_USER, session.orderId);
      expect(order.status).toBe(OrderStatus.CREATED);
      expect(order.subscriptionActivatedAt).toBeNull();
      expect(order.invoiceId).toBeNull();
    }
  });
});
