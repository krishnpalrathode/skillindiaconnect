/**
 * S8-H3 CHAOS — the payment gateway is unreachable / times out mid-checkout.
 *
 * THE PROMISE (S5): activation is WEBHOOK-ONLY. Money is never assumed. A
 * gateway that fails, hangs, or answers garbage must never produce a paid
 * subscription — and the client must never be told it succeeded.
 *
 * Injected at the OUTBOUND NETWORK BOUNDARY (chaos/lib/inject-network-fault.cjs,
 * loaded via --require), not inside the application:
 *   - "refuse" → the socket is refused, like a dead gateway
 *   - "timeout" → the request hangs, like an overloaded one
 * This means the SDK's own error handling, the adapter, the service's catch
 * block and the exception filter all run exactly as in production — and NOT ONE
 * PACKET reaches Razorpay. No live provider is contacted by this scenario.
 *
 * Also proven: after the failure, a later webhook for a legitimately-paid order
 * still activates correctly. A gateway wobble must not poison the account.
 *
 *   pnpm chaos:gateway
 */
import { createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import { OrderStatus, PrismaClient } from '@prisma/client';
import { ChaosRecorder, codeOf, finish, REPO_ROOT, req, startApi } from './lib/harness';
import { build, makeOrder, purge } from './lib/fixtures';

const PORT = Number(process.env.CHAOS_API_PORT ?? 3302);
const prisma = new PrismaClient();
const FAULT = path.join(REPO_ROOT, 'chaos', 'lib', 'inject-network-fault.cjs');
const GATEWAY_HOSTS = 'api.razorpay.com,api.stripe.com';

function signed(raw: Buffer): string {
  return createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!).update(raw).digest('hex');
}

function envelope(orderId: string) {
  return {
    entity: 'event',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: `pay_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
          entity: 'payment',
          status: 'captured',
          notes: { orderId },
        },
      },
    },
  };
}

async function orderState(orderId: string) {
  const [order, invoices, subs, payments] = await Promise.all([
    prisma.order.findUnique({ where: { id: orderId }, select: { status: true } }),
    prisma.invoice.count({ where: { orderId } }),
    prisma.subscription.count({ where: { orderId } }),
    prisma.payment.count({ where: { orderId } }),
  ]);
  return { status: order?.status, invoices, subs, payments };
}

async function main() {
  console.log('S8-H3 CHAOS — payment gateway unreachable');
  console.log('  injection: outbound network fault (no packet leaves for any gateway)\n');

  const fx = await build(prisma);
  const rec = new ChaosRecorder();

  for (const mode of ['refuse', 'timeout'] as const) {
    console.log(`\n══ gateway mode: ${mode} ══`);
    const api = await startApi(PORT + (mode === 'refuse' ? 0 : 1), {
      NODE_OPTIONS: `--require ${FAULT}`,
      CHAOS_FAIL_HOSTS: GATEWAY_HOSTS,
      CHAOS_FAIL_MODE: mode,
      // For "timeout" keep the hang shorter than the client's patience so the
      // scenario finishes; the property under test is the ORDER STATE after a
      // hung gateway, not how long a hang can last.
      CHAOS_FAIL_DELAY_MS: '8000',
      RATE_LIMIT_GLOBAL_PER_MIN: '1000000',
    });

    try {
      const injected = api.logs.some((l) => l.includes('[chaos] network fault ACTIVE'));
      rec.check({
        id: `gateway-${mode}-injection-active`,
        scenario: `Gateway ${mode}`,
        promise: 'Control: the fault is genuinely injected (a scenario that silently failed to inject proves nothing)',
        injected: `network fault mode=${mode}`,
        expected: 'the API logs the chaos banner at boot',
        observed: injected ? 'fault active' : 'NO FAULT INJECTED',
        pass: injected,
        severity: 'Info',
      });

      const before = await prisma.order.count({ where: { companyId: fx.companyId } });
      const res = await req(api.base, 'POST', '/api/v1/billing/checkout', {
        token: fx.employerToken,
        body: { planCode: 'PRO_MONTHLY' },
        timeoutMs: 40_000,
      });

      // ── The client must NOT be told it succeeded ────────────────────────
      rec.check({
        id: `gateway-${mode}-no-false-success`,
        scenario: `Gateway ${mode}`,
        promise: 'A gateway failure NEVER returns a success response to the client',
        injected: `gateway ${mode}`,
        expected: 'non-2xx (502-class), or a client timeout — never a 2xx checkout session',
        observed: `${res.status} ${codeOf(res) ?? ''}`,
        pass: res.status < 200 || res.status >= 300,
        severity: 'Critical',
        detail: { bodyPreview: res.text.slice(0, 160) },
      });

      // ── No order may be left in a paid-looking state ────────────────────
      const orders = await prisma.order.findMany({
        where: { companyId: fx.companyId },
        select: { id: true, status: true, gatewayOrderId: true },
        orderBy: { createdAt: 'desc' },
      });
      const newOrders = orders.slice(0, Math.max(0, orders.length - before));
      const anyPaid = orders.some((o) => o.status === OrderStatus.PAID);
      rec.check({
        id: `gateway-${mode}-no-false-activation`,
        scenario: `Gateway ${mode}`,
        promise: 'Activation is webhook-only — a failed gateway call can never mark an order PAID',
        injected: `gateway ${mode}`,
        expected: 'no order in PAID state',
        observed: anyPaid ? 'AN ORDER IS PAID' : `orders: ${orders.map((o) => o.status).join(',') || 'none'}`,
        pass: !anyPaid,
        severity: 'Critical',
      });

      // The order that was created must be honestly marked, and must carry NO
      // gatewayOrderId — the gateway never issued one.
      const latest = newOrders[0] ?? orders[0];
      if (latest) {
        rec.check({
          id: `gateway-${mode}-order-honest-state`,
          scenario: `Gateway ${mode}`,
          promise: 'The order records what actually happened — CREATED or FAILED, never a fabricated gateway reference',
          injected: `gateway ${mode}`,
          expected: 'status CREATED or FAILED, gatewayOrderId null',
          observed: `status=${latest.status} gatewayOrderId=${latest.gatewayOrderId ?? 'null'}`,
          pass:
            (latest.status === OrderStatus.CREATED || latest.status === OrderStatus.FAILED) &&
            latest.gatewayOrderId === null,
          severity: 'High',
        });

        const st = await orderState(latest.id);
        rec.check({
          id: `gateway-${mode}-no-artifacts`,
          scenario: `Gateway ${mode}`,
          promise: 'A failed checkout leaves NO subscription, invoice, or payment row behind',
          injected: `gateway ${mode}`,
          expected: '0 invoices, 0 subscriptions, 0 payments',
          observed: `invoices=${st.invoices} subs=${st.subs} payments=${st.payments}`,
          pass: st.invoices === 0 && st.subs === 0 && st.payments === 0,
          severity: 'Critical',
        });
      }
    } finally {
      await api.stop();
    }
  }

  // ── Recovery: a real webhook after the outage still activates correctly ──
  console.log('\n══ recovery: webhook arrives after the gateway wobble ══');
  const api = await startApi(PORT + 2, { RATE_LIMIT_GLOBAL_PER_MIN: '1000000' });
  try {
    const orderId = await makeOrder(prisma, fx);
    const raw = Buffer.from(JSON.stringify(envelope(orderId)), 'utf8');

    // Sent with raw `fetch` rather than the harness helper: the signature is
    // computed over these exact bytes, so the body must not be re-serialised.
    const signedRes = await fetch(`${api.base}/api/v1/webhooks/razorpay`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signed(raw),
        'x-razorpay-event-id': `evt_${randomUUID()}`,
      },
      body: raw,
    });
    const st = await orderState(orderId);

    rec.check({
      id: 'gateway-recovery-activation-works',
      scenario: 'Gateway recovery',
      promise: 'A gateway outage does not poison the account — the next legitimate webhook activates normally',
      injected: 'gateway restored; a correctly-signed webhook delivered',
      expected: '200, order PAID, exactly one invoice and one subscription',
      observed: `${signedRes.status}, status=${st.status} invoices=${st.invoices} subs=${st.subs}`,
      pass: signedRes.status === 200 && st.status === OrderStatus.PAID && st.invoices === 1 && st.subs === 1,
      severity: 'High',
    });
  } finally {
    await api.stop();
  }

  if (process.env.CHAOS_KEEP_FIXTURES !== '1') await purge(prisma);
  await prisma.$disconnect();
  finish(rec, 'gateway-down.json');
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
