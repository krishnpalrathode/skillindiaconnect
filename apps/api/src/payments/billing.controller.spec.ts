/**
 * BillingController HTTP-level spec — no Docker needed.
 *
 * The load-bearing assertion here is the SMUGGLED-FIELD REJECTION as a
 * security control. Nest runs GLOBAL pipes before route-level pipes, and the
 * production global ValidationPipe (`whitelist: true`, non-forbidding)
 * silently STRIPS unknown fields — which would let a smuggled `gateway`
 * field sail past a route-level `forbidNonWhitelisted` pipe unseen (found
 * live). CheckoutBodyGuard therefore rejects on the RAW body BEFORE any pipe.
 *
 * To prove that against the real pipe order, this test app registers the SAME
 * global ValidationPipe configuration as main.api.ts — the test reproduces
 * production, not a bare module.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import supertest from 'supertest';
import { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { validationProblemFactory } from '../core/http-problem.filter';
import { BillingController } from './billing.controller';
import { CheckoutService, CheckoutSessionDto } from './checkout.service';

describe('BillingController (HTTP)', () => {
  let app: INestApplication;
  let checkoutMock: { checkout: jest.Mock; getPlans: jest.Mock; getSubscription: jest.Mock; getOrder: jest.Mock };
  // Mutable per-test identity injected where JwtAuthGuard would put it.
  let currentUser: CurrentUserPayload;

  const SESSION: CheckoutSessionDto = {
    orderId: '4f6d2c1e-9b7a-4c3d-8e2f-1a2b3c4d5e6f',
    gateway: 'RAZORPAY',
    amountSubunits: 299_900,
    gstSubunits: 53_982,
    totalSubunits: 353_882,
    currency: 'INR',
    razorpay: { keyId: 'rzp_test_key', gatewayOrderId: 'order_test_1' },
  };

  beforeAll(async () => {
    checkoutMock = {
      checkout: jest.fn().mockResolvedValue(SESSION),
      getPlans: jest.fn().mockResolvedValue([]),
      getSubscription: jest.fn(),
      getOrder: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [{ provide: CheckoutService, useValue: checkoutMock }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(
      (req: { user?: CurrentUserPayload }, _res: unknown, next: () => void) => {
        req.user = currentUser;
        next();
      },
    );
    // Mirror main.api.ts EXACTLY: the global whitelist pipe strips unknown
    // fields BEFORE route pipes — the environment that hid the smuggled-field
    // pass-through until the live check caught it.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: validationProblemFactory,
      }),
    );
    await app.init();
  });

  afterAll(async () =>
    app.close());

  beforeEach(() => {
    jest.clearAllMocks();
    checkoutMock.checkout.mockResolvedValue(SESSION);
    currentUser = { userId: 'u-emp-1', role: UserRole.EMPLOYER, jti: 'j', exp: 0 };
  });

  // ── The whitelist as a security control ──────────────────────────────────

  it('rejects a smuggled `gateway` field with 400 (never stripped, never routed on)', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/billing/checkout')
      .send({ planCode: 'PRO_MONTHLY', gateway: 'STRIPE' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.meta)).toContain('gateway');
    // The service was NEVER reached — the field could not influence routing.
    expect(checkoutMock.checkout).not.toHaveBeenCalled();
  });

  it('rejects smuggled money fields (`amountSubunits`, `currency`) with 400', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/billing/checkout')
      .send({ planCode: 'PRO_MONTHLY', amountSubunits: 1, currency: 'USD' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(checkoutMock.checkout).not.toHaveBeenCalled();
  });

  it('rejects a missing/empty planCode with 400', async () => {
    const res = await supertest(app.getHttpServer()).post('/billing/checkout').send({});
    expect(res.status).toBe(400);
    expect(checkoutMock.checkout).not.toHaveBeenCalled();
  });

  // ── The clean request path ────────────────────────────────────────────────

  it('a clean { planCode } body → 201 with the session; Idempotency-Key forwarded', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/billing/checkout')
      .set('Idempotency-Key', 'idem-123')
      .send({ planCode: 'PRO_MONTHLY' });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual(SESSION);
    expect(checkoutMock.checkout).toHaveBeenCalledWith(
      'u-emp-1',
      'PRO_MONTHLY',
      'idem-123',
      UserRole.EMPLOYER,
    );
  });

  // ── Role gate ─────────────────────────────────────────────────────────────

  it('a non-EMPLOYER caller gets 403 NOT_EMPLOYER on every billing route', async () => {
    currentUser = { userId: 'u-cand-1', role: UserRole.CANDIDATE, jti: 'j', exp: 0 };

    // Build each request INSIDE the loop — supertest binds an ephemeral
    // listener per request, so pre-built request chains go stale.
    const calls: Array<[method: 'get' | 'post', path: string]> = [
      ['get', '/billing/plans'],
      ['get', '/billing/subscription'],
      ['post', '/billing/checkout'],
      ['get', '/billing/orders/4f6d2c1e-9b7a-4c3d-8e2f-1a2b3c4d5e6f'],
    ];
    for (const [method, path] of calls) {
      const req = supertest(app.getHttpServer())[method](path);
      const res = await (method === 'post' ? req.send({ planCode: 'PRO_MONTHLY' }) : req);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('NOT_EMPLOYER');
    }
    expect(checkoutMock.checkout).not.toHaveBeenCalled();
  });

  it('the order poll validates the id as a UUID (400 otherwise)', async () => {
    const res = await supertest(app.getHttpServer()).get('/billing/orders/not-a-uuid');
    expect(res.status).toBe(400);
    expect(checkoutMock.getOrder).not.toHaveBeenCalled();
  });
});
