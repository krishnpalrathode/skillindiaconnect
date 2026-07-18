/**
 * S8-H2 PRIORITY 3 — webhook signature verification, attacked.
 *
 * TEST-MODE WIRING: every envelope is built and signed LOCALLY with
 * RAZORPAY_WEBHOOK_SECRET (HMAC-SHA256 over the raw bytes) — exactly what
 * RazorpayAdapter.verifyWebhook checks. No call is made to any gateway.
 *
 * The properties under attack:
 *  1. VERIFY BEFORE PARSE — a bad signature must be rejected without the body
 *     ever being parsed, and without any side effect. Proven with a body that
 *     is BOTH unsigned AND unparseable: if the response is a JSON syntax error
 *     rather than a 401, parsing happened first.
 *  2. TAMPERING — body modified after signing, signature from the wrong secret,
 *     wrong gateway's signature, missing/empty/malformed signature, truncated
 *     signature, and a valid signature over a DIFFERENT body (cut-and-paste).
 *  3. NO SIDE EFFECTS — after every rejected attempt, the target order must be
 *     untouched: still CREATED, no invoice, no subscription, no payment row.
 *  4. RAW-BODY SCOPING — the production-only regression. The two webhook paths
 *     get raw bytes; every OTHER route must still parse JSON normally.
 *
 *   pnpm security:webhook
 */
import './lib/env';
import { createHmac, randomUUID } from 'node:crypto';
import { Currency, Gateway, OrderStatus, PrismaClient } from '@prisma/client';
import { startApi, req, codeOf } from './lib/api';
import { build, purge } from './lib/fixtures';
import { Recorder } from './lib/report';

const PORT = Number(process.env.SEC_API_PORT ?? 3205);
const prisma = new PrismaClient();
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const OWASP = 'A02:2021 Cryptographic Failures / A08:2021 Data Integrity Failures';

if (!SECRET) throw new Error('RAZORPAY_WEBHOOK_SECRET missing — cannot exercise the signing path');

function envelope(orderId: string, paymentId = `pay_${randomUUID().slice(0, 14)}`) {
  return {
    entity: 'event',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: { id: paymentId, entity: 'payment', status: 'captured', notes: { orderId } },
      },
    },
  };
}

const sign = (raw: Buffer | string, secret: string) =>
  createHmac('sha256', secret).update(raw).digest('hex');

async function main() {
  console.log('S8-H2 — webhook signature tampering probes');
  console.log('  wiring: locally-signed envelopes; NO gateway is contacted\n');

  const fx = await build(prisma);
  const rec = new Recorder();

  const plan = await prisma.plan.findFirstOrThrow({ where: { code: { not: 'FREE' } }, select: { id: true } });
  const mkOrder = async () =>
    (
      await prisma.order.create({
        data: {
          companyId: fx.A.companyId,
          planId: plan.id,
          gateway: Gateway.RAZORPAY,
          amountSubunits: 500_000,
          gstSubunits: 90_000,
          totalSubunits: 590_000,
          currency: Currency.INR,
          status: OrderStatus.CREATED,
        },
      })
    ).id;

  const api = await startApi(PORT);
  const URL = '/api/v1/webhooks/razorpay';

  try {
    // ── 1. The CONTROL: a correctly-signed event MUST be accepted ──────────
    // Without this, every "rejected" result below could be a broken endpoint
    // rather than working verification.
    const goodOrder = await mkOrder();
    const goodRaw = Buffer.from(JSON.stringify(envelope(goodOrder)), 'utf8');
    const good = await req(api.base, 'POST', URL, {
      raw: goodRaw,
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': sign(goodRaw, SECRET!),
        'x-razorpay-event-id': `evt_${randomUUID()}`,
      },
    });
    const goodOrderAfter = await prisma.order.findUnique({ where: { id: goodOrder }, select: { status: true } });
    rec.expect({
      id: 'webhook-control-valid-accepted',
      group: 'webhook — control',
      description: 'a correctly-signed event must be ACCEPTED and activate the order',
      expected: '200 and the order PAID',
      actual: `${good.status}, order=${goodOrderAfter?.status}`,
      pass: good.status === 200 && goodOrderAfter?.status === OrderStatus.PAID,
      severity: 'Info',
      owasp: OWASP,
    });

    // ── 2. TAMPERING CASES ─────────────────────────────────────────────────
    const cases: { id: string; description: string; build: () => Promise<{ raw: string | Buffer; sig?: string; orderId: string }> }[] = [
      {
        id: 'no-signature',
        description: 'no signature header at all',
        build: async () => {
          const orderId = await mkOrder();
          return { raw: JSON.stringify(envelope(orderId)), orderId };
        },
      },
      {
        id: 'empty-signature',
        description: 'an empty signature header',
        build: async () => {
          const orderId = await mkOrder();
          return { raw: JSON.stringify(envelope(orderId)), sig: '', orderId };
        },
      },
      {
        id: 'garbage-signature',
        description: 'a non-hex garbage signature',
        build: async () => {
          const orderId = await mkOrder();
          return { raw: JSON.stringify(envelope(orderId)), sig: 'not-a-signature', orderId };
        },
      },
      {
        id: 'wrong-secret',
        description: 'a well-formed signature made with the WRONG secret',
        build: async () => {
          const orderId = await mkOrder();
          const raw = JSON.stringify(envelope(orderId));
          return { raw, sig: sign(raw, 'attacker-guessed-secret'), orderId };
        },
      },
      {
        id: 'body-modified-after-signing',
        description: 'body altered AFTER signing (the classic tamper)',
        build: async () => {
          const orderId = await mkOrder();
          const original = JSON.stringify(envelope(orderId));
          const sig = sign(original, SECRET!);
          // Escalate the amount after signing — the signature no longer matches.
          const tampered = original.replace('"captured"', '"captured","amount":99999999');
          return { raw: tampered, sig, orderId };
        },
      },
      {
        id: 'cut-and-paste-valid-signature',
        description: "a VALID signature lifted from a different event (replayed onto another order)",
        build: async () => {
          const victimOrder = await mkOrder();
          const otherRaw = JSON.stringify(envelope('some-other-order'));
          const validSigForOther = sign(otherRaw, SECRET!);
          // Valid signature, but for different bytes than the ones sent.
          return { raw: JSON.stringify(envelope(victimOrder)), sig: validSigForOther, orderId: victimOrder };
        },
      },
      {
        id: 'truncated-signature',
        description: 'a correct signature truncated by one character (length-check probe)',
        build: async () => {
          const orderId = await mkOrder();
          const raw = JSON.stringify(envelope(orderId));
          return { raw, sig: sign(raw, SECRET!).slice(0, -1), orderId };
        },
      },
      {
        id: 'stripe-signature-on-razorpay',
        description: "the other gateway's signature format on the Razorpay route",
        build: async () => {
          const orderId = await mkOrder();
          const raw = JSON.stringify(envelope(orderId));
          return { raw, sig: `t=${Date.now()},v1=${sign(raw, SECRET!)}`, orderId };
        },
      },
      {
        id: 'unsigned-and-unparseable',
        description:
          'an unsigned body that is ALSO invalid JSON — a parse error here would prove parsing precedes verification',
        build: async () => {
          const orderId = await mkOrder();
          return { raw: '{"event": "payment.captured", NOT VALID JSON {{{', orderId };
        },
      },
    ];

    for (const c of cases) {
      const { raw, sig, orderId } = await c.build();
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (sig !== undefined) headers['x-razorpay-signature'] = sig;
      headers['x-razorpay-event-id'] = `evt_${randomUUID()}`;

      const res = await req(api.base, 'POST', URL, { raw, headers });

      rec.expect({
        id: `webhook-reject-${c.id}`,
        group: 'webhook — signature verification',
        description: `${c.description} must be rejected with 401`,
        expected: '401 INVALID_SIGNATURE',
        actual: `${res.status} ${codeOf(res) ?? ''}`,
        pass: res.status === 401,
        severity: 'Critical',
        owasp: OWASP,
      });

      // THE SIDE-EFFECT CHECK — nothing may have happened.
      const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
      const invoices = await prisma.invoice.count({ where: { orderId } });
      const payments = await prisma.payment.count({ where: { orderId } });
      const subs = await prisma.subscription.count({ where: { orderId } });
      const untouched =
        (order?.status ?? OrderStatus.CREATED) === OrderStatus.CREATED &&
        invoices === 0 &&
        payments === 0 &&
        subs === 0;

      rec.expect({
        id: `webhook-no-side-effect-${c.id}`,
        group: 'webhook — no side effects on rejection',
        description: `${c.description} must leave the order completely untouched`,
        expected: 'order CREATED, 0 invoices, 0 payments, 0 subscriptions',
        actual: `order=${order?.status} invoices=${invoices} payments=${payments} subs=${subs}`,
        pass: untouched,
        severity: 'Critical',
        owasp: OWASP,
      });

      if (c.id === 'unsigned-and-unparseable') {
        // VERIFY-BEFORE-PARSE, proven: the response must be the signature 401,
        // NOT a JSON-syntax 400. A parse error would mean the body was parsed
        // before the signature was checked.
        rec.expect({
          id: 'webhook-verify-before-parse',
          group: 'webhook — verify before parse',
          description:
            'an unsigned + unparseable body must fail on the SIGNATURE, never on JSON parsing',
          expected: '401 (signature checked first)',
          actual: `${res.status} ${codeOf(res) ?? ''}`,
          pass: res.status === 401,
          severity: 'Critical',
          owasp: OWASP,
        });
      }
    }

    // ── 3. REPLAY of a genuinely valid event (dedupe, not signature) ───────
    const replayRaw = Buffer.from(JSON.stringify(envelope(goodOrder)), 'utf8');
    const replayEventId = `evt_${randomUUID()}`;
    const h = {
      'content-type': 'application/json',
      'x-razorpay-signature': sign(replayRaw, SECRET!),
      'x-razorpay-event-id': replayEventId,
    };
    await req(api.base, 'POST', URL, { raw: replayRaw, headers: h });
    const replay2 = await req(api.base, 'POST', URL, { raw: replayRaw, headers: h });
    const invoicesForGood = await prisma.invoice.count({ where: { orderId: goodOrder } });
    rec.expect({
      id: 'webhook-replay-dedupe',
      group: 'webhook — replay',
      description: 'replaying an identical signed event must be a 200 no-op, never a second activation',
      expected: '200 and exactly ONE invoice for the order',
      actual: `${replay2.status}, invoices=${invoicesForGood}`,
      pass: replay2.status === 200 && invoicesForGood === 1,
      severity: 'High',
      owasp: OWASP,
    });

    // ── 4. RAW-BODY SCOPING (the production-only regression) ───────────────
    // A normal route must still parse JSON. If express.raw() had been mounted
    // globally, every JSON endpoint would see a Buffer and validation would
    // fail in ways that only show up in a real HTTP server.
    const normal = await req(api.base, 'POST', '/api/v1/auth/login', {
      body: { email: 'nobody@sec-probe.local', password: 'wrong-password' },
    });
    rec.expect({
      id: 'raw-body-scoping-normal-route-parses',
      group: 'webhook — raw-body scoping',
      description: 'a NON-webhook route must still parse JSON normally (raw() must not be global)',
      expected: 'a domain response (401 INVALID_CREDENTIALS), not a body-shape error',
      actual: `${normal.status} ${codeOf(normal) ?? ''}`,
      pass: normal.status === 401 && codeOf(normal) === 'INVALID_CREDENTIALS',
      severity: 'High',
      owasp: 'A05:2021 Security Misconfiguration',
    });

    const validated = await req(api.base, 'POST', '/api/v1/auth/signup', {
      body: { email: 'not-an-email', password: 'x' },
    });
    rec.expect({
      id: 'raw-body-scoping-validation-runs',
      group: 'webhook — raw-body scoping',
      description: 'DTO validation must run on a normal route (proves the parsed body reached the pipe)',
      expected: '400 VALIDATION_ERROR',
      actual: `${validated.status} ${codeOf(validated) ?? ''}`,
      pass: validated.status === 400 && codeOf(validated) === 'VALIDATION_ERROR',
      severity: 'High',
      owasp: 'A05:2021 Security Misconfiguration',
    });
  } finally {
    await api.stop();
  }

  rec.print();
  console.log(`\n${rec.summary()}`);
  console.log(`evidence → ${rec.write('webhook-probes.json')}`);

  if (process.env.SEC_KEEP_FIXTURES !== '1') await purge(prisma);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
