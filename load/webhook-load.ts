/**
 * S8-H1 — payment webhook path under concurrency.
 *
 * TEST MODE / MOCK WIRING — read this before running:
 *   Webhooks are INBOUND. This script builds a Razorpay `payment.captured`
 *   envelope itself and signs it with HMAC-SHA256 over the raw bytes using
 *   RAZORPAY_WEBHOOK_SECRET from the repo-root .env — exactly what
 *   RazorpayAdapter.verifyWebhook checks. NO request is made to Razorpay, and
 *   no Razorpay API key is used. Orders are created directly in the database
 *   rather than through checkout (checkout is the one path that legitimately
 *   calls the gateway, so it is deliberately not load-tested).
 *
 * What is being measured:
 *   1. Activation latency + throughput at concurrency — the transaction holds a
 *      `SELECT … FOR UPDATE` on the order row and does ~6 writes.
 *   2. LOCK CONTENTION, isolated two ways:
 *        - DISTINCT orders  → no two requests want the same row; contention
 *                             here is pool/CPU, not the row lock.
 *        - SAME order ×N    → every request wants the same row; this is the
 *                             duplicate-delivery storm the lock exists for.
 *                             Exactly ONE must activate; the rest no-op.
 *   3. INVOICE SEQUENCE INTEGRITY under real concurrent load — S5-B2's
 *      guarantee. Every invoice number issued during the run is collected and
 *      checked for duplicates and for gaps-vs-duplicates.
 *   4. The 200-fast property: does the webhook still respond quickly at load.
 *
 *   pnpm load:webhook
 *   LOAD_WEBHOOK_ORDERS=300 LOAD_WEBHOOK_CONCURRENCY=1,10,25,50 pnpm load:webhook
 */
import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ChildProcess, spawn } from 'node:child_process';
import { Currency, Gateway, OrderStatus, PrismaClient } from '@prisma/client';
import { API_DIST, REPO_ROOT, loadRootEnv, sleep, stats, table } from './lib/harness';

loadRootEnv();

const prisma = new PrismaClient();

const PORT = Number(process.env.LOAD_API_PORT ?? 3102);
const BASE = `http://127.0.0.1:${PORT}`;
const WEBHOOK_URL = `${BASE}/api/v1/webhooks/razorpay`;
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const ORDERS = Number(process.env.LOAD_WEBHOOK_ORDERS ?? 200);
const CONCURRENCIES = (process.env.LOAD_WEBHOOK_CONCURRENCY ?? '1,10,25,50').split(',').map(Number);

if (!SECRET) throw new Error('RAZORPAY_WEBHOOK_SECRET is not set — cannot sign test webhooks');

// ─────── Envelope construction ──────────────────────────────────────────────

/** A Razorpay `payment.captured` envelope carrying OUR order id in notes. */
function buildEvent(orderId: string, paymentId: string) {
  return {
    entity: 'event',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: paymentId,
          entity: 'payment',
          status: 'captured',
          order_id: `order_load_${orderId.slice(0, 12)}`,
          method: 'card',
          notes: { orderId },
        },
      },
    },
  };
}

interface PostResult {
  status: number;
  ms: number;
}

async function postWebhook(orderId: string, paymentId: string, eventId: string): Promise<PostResult> {
  const raw = Buffer.from(JSON.stringify(buildEvent(orderId, paymentId)), 'utf8');
  const signature = createHmac('sha256', SECRET!).update(raw).digest('hex');
  const started = Date.now();
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': signature,
      // The canonical dedupe key. A distinct id per delivery means the
      // webhook_events dedupe does NOT short-circuit — we want every request
      // to reach the activation transaction and contend for the lock.
      'x-razorpay-event-id': eventId,
    },
    body: raw,
  });
  await res.text();
  return { status: res.status, ms: Date.now() - started };
}

// ─────── Fixtures ───────────────────────────────────────────────────────────

async function createOrders(n: number): Promise<string[]> {
  const company = await prisma.company.findFirstOrThrow({
    where: { registrationNumber: { startsWith: 'LOADTEST-' } },
    select: { id: true },
  });
  // A paid plan, so activation creates a real subscription term rather than
  // taking the FREE-plan branch.
  const plan = await prisma.plan.findFirstOrThrow({
    where: { code: { not: 'FREE' } },
    select: { id: true },
  });

  const ids: string[] = [];
  for (let i = 0; i < n; i += 100) {
    const batch = Array.from({ length: Math.min(100, n - i) }, () => ({
      id: randomUUID(),
      companyId: company.id,
      planId: plan.id,
      gateway: Gateway.RAZORPAY,
      amountSubunits: 500_000,
      gstSubunits: 90_000,
      totalSubunits: 590_000,
      currency: Currency.INR,
      status: OrderStatus.CREATED,
    }));
    await prisma.order.createMany({ data: batch });
    ids.push(...batch.map((b) => b.id));
  }
  return ids;
}

/** Run `tasks` with at most `concurrency` in flight. */
async function pooled<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= tasks.length) return;
        out[i] = await tasks[i]!();
      }
    }),
  );
  return out;
}

// ─────── API process ────────────────────────────────────────────────────────

async function startApi(): Promise<ChildProcess> {
  const proc = spawn(process.execPath, [path.join(API_DIST, 'main.api.js')], {
    env: { ...process.env, PORT: String(PORT) },
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log: string[] = [];
  proc.stdout!.on('data', (c: Buffer) => log.push(c.toString()));
  proc.stderr!.on('data', (c: Buffer) => log.push(c.toString()));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`API exited (${proc.exitCode}):\n${log.join('')}`);
    try {
      if ((await fetch(`${BASE}/health`)).ok) return proc;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  proc.kill('SIGKILL');
  throw new Error(`API did not become healthy:\n${log.join('')}`);
}

// ─────── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('S8-H1 — payment webhook load test');
  console.log('  wiring: self-signed Razorpay envelopes (HMAC over raw bytes, local secret).');
  console.log('  NO call is made to Razorpay; no gateway API key is used.\n');

  const api = await startApi();
  console.log(`API up on ${BASE} (pid ${api.pid})`);

  const invoicesBefore = await prisma.invoice.count();
  const runStartedAt = new Date();
  const distinctRows: Record<string, unknown>[] = [];
  const sameOrderRows: Record<string, unknown>[] = [];

  try {
    // ── 1. DISTINCT orders — throughput + activation latency ────────────────
    console.log('\n══ distinct orders (no row-lock contention by construction) ══');
    for (const c of CONCURRENCIES) {
      const orderIds = await createOrders(ORDERS);
      const tasks = orderIds.map((id) => () =>
        postWebhook(id, `pay_${randomUUID().replace(/-/g, '').slice(0, 14)}`, `evt_${randomUUID()}`),
      );
      const t0 = Date.now();
      const results = await pooled(tasks, c);
      const wallMs = Date.now() - t0;

      const l = stats(results.map((r) => r.ms));
      const nonOk = results.filter((r) => r.status !== 200).length;
      const activated = await prisma.order.count({
        where: { id: { in: orderIds }, status: OrderStatus.PAID },
      });
      const row = {
        concurrency: c,
        requests: results.length,
        wallMs,
        rps: Math.round((results.length / wallMs) * 1000),
        p50: Math.round(l.p50),
        p95: Math.round(l.p95),
        p99: Math.round(l.p99),
        max: Math.round(l.max),
        non200: nonOk,
        activated,
      };
      distinctRows.push(row);
      console.log(
        `  c=${c}: ${row.rps} rps  p50=${row.p50}ms p95=${row.p95}ms p99=${row.p99}ms  ` +
          `activated=${activated}/${orderIds.length} non200=${nonOk}`,
      );
    }

    // ── 2. SAME order, N concurrent deliveries — the lock's whole purpose ────
    console.log('\n══ same order, concurrent duplicate deliveries (row-lock contention) ══');
    for (const c of CONCURRENCIES.filter((x) => x > 1)) {
      const [orderId] = await createOrders(1);
      // Distinct event ids so webhook_events dedupe does NOT absorb them —
      // every one must reach the activation transaction and hit the lock.
      const tasks = Array.from({ length: c }, () => () =>
        postWebhook(orderId!, `pay_${randomUUID().replace(/-/g, '').slice(0, 14)}`, `evt_${randomUUID()}`),
      );
      const t0 = Date.now();
      const results = await pooled(tasks, c);
      const wallMs = Date.now() - t0;

      const l = stats(results.map((r) => r.ms));
      const invoices = await prisma.invoice.count({ where: { orderId: orderId! } });
      const subs = await prisma.subscription.count({ where: { orderId: orderId! } });
      const payments = await prisma.payment.count({ where: { orderId: orderId! } });
      const row = {
        concurrentDeliveries: c,
        wallMs,
        p50: Math.round(l.p50),
        p95: Math.round(l.p95),
        max: Math.round(l.max),
        non200: results.filter((r) => r.status !== 200).length,
        invoices,
        subscriptions: subs,
        paymentsRows: payments,
        verdict: invoices === 1 && subs === 1 ? 'OK — exactly one activation' : '✗ DUPLICATE ACTIVATION',
      };
      sameOrderRows.push(row);
      console.log(
        `  ${c} simultaneous deliveries → invoices=${invoices} subscriptions=${subs} ` +
          `payments=${payments} p95=${row.p95}ms → ${row.verdict}`,
      );
    }

    // ── 3. Invoice sequence integrity across everything issued in this run ──
    const issued = await prisma.invoice.findMany({
      // Exactly this run's invoices — a wider window would fold in earlier runs
      // and make the duplicate/gap counts unattributable.
      where: { issuedAt: { gte: runStartedAt } },
      select: { number: true },
      orderBy: { number: 'asc' },
    });
    const numbers = issued.map((i) => i.number);
    const unique = new Set(numbers);
    const seqs = numbers
      .map((n) => Number(n.split('-')[2]))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const duplicates = numbers.length - unique.size;
    const gaps = seqs.length > 1 ? seqs[seqs.length - 1]! - seqs[0]! + 1 - seqs.length : 0;

    console.log('\n══ invoice sequence integrity ══');
    console.log(`  invoices before run: ${invoicesBefore}, issued during run: ${numbers.length}`);
    console.log(`  distinct numbers   : ${unique.size}`);
    console.log(`  DUPLICATES         : ${duplicates}  ${duplicates === 0 ? '✓ none' : '✗ SEQUENCE VIOLATED'}`);
    console.log(
      `  gaps in sequence   : ${gaps} (expected and acceptable — Postgres sequences are\n` +
        '                       non-transactional, so a rolled-back activation burns its number;\n' +
        '                       GST requires uniqueness and order, not gaplessness)',
    );
    console.log(`  range              : ${numbers[0] ?? '-'} … ${numbers[numbers.length - 1] ?? '-'}`);

    console.log('\n── distinct-order results ──');
    table(distinctRows);
    console.log('\n── same-order contention results ──');
    table(sameOrderRows);

    const outDir = path.join(REPO_ROOT, 'load', 'results');
    mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `webhook-load-${Date.now()}.json`);
    writeFileSync(
      out,
      JSON.stringify(
        { ordersPerLevel: ORDERS, concurrencies: CONCURRENCIES, distinctRows, sameOrderRows,
          invoiceIntegrity: { issued: numbers.length, distinct: unique.size, duplicates, gaps } },
        null,
        2,
      ),
    );
    console.log(`\nfull results → ${path.relative(REPO_ROOT, out)}`);
  } finally {
    api.kill('SIGTERM');
    await sleep(1_500);
    if (api.exitCode === null) api.kill('SIGKILL');
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
