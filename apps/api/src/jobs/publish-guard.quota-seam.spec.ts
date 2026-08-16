/**
 * S5-B3 quota-seam proof, end to end on real Postgres:
 *
 *   Free employer at cap → JOB_QUOTA_EXCEEDED
 *   → Pro activated via S5-B2's REAL webhook path (genuinely HMAC-signed
 *     Razorpay fixture through WebhookService → ActivationService)
 *   → the SAME publish succeeds — with no gate-code change beyond the
 *     converged effectivePlan() read.
 *   GRACE retains Pro capacity; EXPIRED enforces the Free cap on the NEXT
 *   publish attempt (already-live overage is the pause rule's job, not the
 *   gate's).
 *
 * SettingsService is stubbed (protection rules OFF, Free cap 1) — the
 * Settings-driven behavior is covered by publish-guard.service.spec; THIS
 * unit pins the subscription seam.
 */
import { createHmac } from 'node:crypto';
import { UnprocessableEntityException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CompanyStatus,
  CompanyType,
  Currency,
  EmploymentType,
  Gateway,
  JobMarket,
  JobStatus,
  OrderStatus,
  PlanPeriod,
  PrismaClient,
  SubscriptionStatus,
  UserRole,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import * as path from 'path';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { EmployerService } from '../employer/employer.service';
import { NotificationService } from '../notifications/notification.service';
import { RazorpayAdapter } from '../payments/gateways/razorpay.adapter';
import { StripeAdapter } from '../payments/gateways/stripe.adapter';
import { InvoiceService } from '../payments/invoice.service';
import { ActivationService } from '../payments/activation.service';
import { PaymentEventsHandler } from '../payments/webhooks/handlers/payment-events.handler';
import { WebhookService } from '../payments/webhooks/webhook.service';
import { SubscriptionReadService } from '../payments/subscription-read.service';
import { PublishGuardService } from './publish-guard.service';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');
const RZP_WEBHOOK_SECRET = 'rzp_whsec_seam_test';

let pg: StartedTestContainer;
let prisma: PrismaClient;
let publishGuard: PublishGuardService;
let webhooks: WebhookService;
let dockerUnavailable = false;

let proPlanId: string;
let categoryId: string;
let companyId: string;
let userId: string;
let seq = 0;
const uid = (p: string) => `${p}_${Date.now()}_${++seq}`;

// Settings stub: protection rules OFF, Free cap = 1 (the seeded default).
const settingsStub = {
  get: async (def: { key: string }) => (def.key === 'jobs.free_max_active_jobs' ? 1 : false),
} as unknown as SettingsService;

function signedRzpSuccess(orderId: string): {
  body: Buffer;
  headers: Record<string, string>;
} {
  const body = Buffer.from(
    JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: { id: uid('pay'), order_id: uid('gwo'), notes: { orderId } },
        },
      },
    }),
  );
  return {
    body,
    headers: {
      'x-razorpay-signature': createHmac('sha256', RZP_WEBHOOK_SECRET).update(body).digest('hex'),
      'x-razorpay-event-id': uid('evt'),
    },
  };
}

beforeAll(async () => {
  try {
    pg = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_USER: 'sic',
        POSTGRES_PASSWORD: 'sic',
        POSTGRES_DB: 'sic_quota_seam',
      })
      .withExposedPorts(5432)
      .start();
    const url = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_quota_seam`;
    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();

    proPlanId = (
      await prisma.plan.create({
        data: {
          code: 'PRO_MONTHLY',
          name: 'Pro Monthly',
          priceSubunits: 299_900,
          period: PlanPeriod.MONTHLY,
          maxActiveJobs: null,
          features: [],
        },
      })
    ).id;
    categoryId = (
      await prisma.jobCategory.create({ data: { slug: 'qs-general', nameEn: 'QS General' } })
    ).id;

    const user = await prisma.user.create({
      data: { email: 'qs-emp@example.com', role: UserRole.EMPLOYER },
    });
    userId = user.id;
    companyId = (
      await prisma.company.create({
        data: {
          name: 'Quota Seam Co',
          type: CompanyType.LOCAL,
          status: CompanyStatus.APPROVED,
          registrationNumber: 'QS-1',
          industryType: 'Construction',
          phone: '+91555',
          location: 'Delhi',
          employeeRange: '10-50',
        },
      })
    ).id;
    await prisma.employerUser.create({ data: { userId, companyId, isPrimary: true } });

    const prismaSvc = prisma as unknown as PrismaService;
    const audit = new AuditService(prismaSvc);
    const employer = new EmployerService(prismaSvc, null as never, { notify: jest.fn() } as never);

    // The gate under test — with the REAL converged read.
    publishGuard = new PublishGuardService(
      prismaSvc,
      employer,
      settingsStub,
      audit,
      new SubscriptionReadService(prismaSvc, settingsStub),
      new EventEmitter2(),
    );

    // The REAL S5-B2 webhook path (real adapter verification; notification
    // fan-out stubbed at the service boundary — the worker owns delivery).
    const config = {
      get: (k: string) =>
        ({
          RAZORPAY_KEY_ID: 'rzp_test_seam',
          RAZORPAY_KEY_SECRET: 'seam_secret',
          RAZORPAY_WEBHOOK_SECRET: RZP_WEBHOOK_SECRET,
          STRIPE_SECRET_KEY: 'sk_test_dummy',
          STRIPE_WEBHOOK_SECRET: 'whsec_seam_test',
          WEB_APP_URL: 'http://localhost:3000',
        })[k],
    } as unknown as ConfigService;
    const activation = new ActivationService(
      prismaSvc,
      new InvoiceService(),
      employer,
      { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationService,
      audit,
      new EventEmitter2(),
      // S7-B1: the post-commit invoice-render enqueue — inert here.
      { add: jest.fn().mockResolvedValue(undefined) } as never,
      // C3: the activation metric — inert stub.
      { recordActivation: jest.fn() } as never,
    );
    const handler = new PaymentEventsHandler(prismaSvc, activation, audit);
    webhooks = new WebhookService(
      prismaSvc,
      handler,
      audit,
      new RazorpayAdapter(config),
      new StripeAdapter(config),
      // C3: the webhook metric — inert stub.
      { recordWebhook: jest.fn() } as never,
    );
  } catch {
    dockerUnavailable = true;
    // eslint-disable-next-line no-console
    console.warn('Docker unavailable — skipping quota-seam tests.');
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

// GULF: this suite is about the QUOTA gate, so the protection gate before it
// must pass rather than be skipped — a LOCAL job would bypass check 2 and hide
// an ordering regression.
const draftJob = () => ({
  id: uid('job'),
  companyId,
  market: JobMarket.GULF,
  accommodation: true,
  healthInsurance: true,
  transportation: true,
});

const assertPublish = () =>
  publishGuard.assertPublishable(draftJob(), { id: companyId }, userId, UserRole.EMPLOYER);

async function expectQuotaExceeded(): Promise<void> {
  let err: UnprocessableEntityException | undefined;
  try {
    await assertPublish();
  } catch (e) {
    err = e as UnprocessableEntityException;
  }
  expect(err).toBeInstanceOf(UnprocessableEntityException);
  const body = err!.getResponse() as Record<string, unknown>;
  expect(body.code).toBe('JOB_QUOTA_EXCEEDED');
  expect((body.meta as Record<string, unknown>).planLimit).toBe(1);
}

// The story runs in order against ONE company — blocked → activated → GRACE → EXPIRED.
describe('publish quota ↔ live subscription seam', () => {
  gatedIt('Free at cap (1 active job) → JOB_QUOTA_EXCEEDED', async () => {
    await prisma.job.create({
      data: {
        companyId,
        title: 'Seam Job 1',
        employmentType: EmploymentType.FULL_TIME,
        market: JobMarket.LOCAL,
        location: 'Delhi',
        description: 'Quota seam job',
        categoryId,
        salaryMin: 100,
        salaryMax: 200,
        currency: Currency.INR,
        hoursPerDay: 8,
        daysPerWeek: 5,
        status: JobStatus.ACTIVE,
        publishedAt: new Date(),
      },
    });
    await expectQuotaExceeded();
  });

  gatedIt('Pro activated through the REAL signed webhook → the SAME publish succeeds', async () => {
    const order = await prisma.order.create({
      data: {
        companyId,
        planId: proPlanId,
        gateway: Gateway.RAZORPAY,
        amountSubunits: 299_900,
        gstSubunits: 53_982,
        totalSubunits: 353_882,
        currency: Currency.INR,
        status: OrderStatus.CREATED,
        gatewayOrderId: uid('gwo'),
      },
    });

    const { body, headers } = signedRzpSuccess(order.id);
    await webhooks.process('razorpay', body, headers);

    // The webhook really activated a live subscription…
    const sub = await prisma.subscription.findFirstOrThrow({ where: { companyId } });
    expect(sub.status).toBe(SubscriptionStatus.ACTIVE);

    // …and the gate now passes with zero gate-side special-casing.
    await expect(assertPublish()).resolves.toBeUndefined();
  });

  gatedIt('GRACE retains Pro capacity (grace still means they paid)', async () => {
    await prisma.subscription.updateMany({
      where: { companyId },
      data: {
        status: SubscriptionStatus.GRACE,
        graceEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    await expect(assertPublish()).resolves.toBeUndefined();
  });

  gatedIt('EXPIRED enforces the Free cap on the NEXT publish attempt', async () => {
    await prisma.subscription.updateMany({
      where: { companyId },
      data: { status: SubscriptionStatus.EXPIRED },
    });
    // The one live job from the first test still counts against the Free cap.
    await expectQuotaExceeded();
  });
});
