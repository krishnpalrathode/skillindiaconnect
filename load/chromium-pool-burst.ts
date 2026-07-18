/**
 * S8-H1 — THE priority load test: the S7-B1 Chromium pool under burst.
 *
 * The question this answers is NOT "how fast is one resume". It is:
 *
 *   1. At what render concurrency does the worker's memory become unsafe?
 *   2. Do the pool's cap + queue + timeout + recycle actually HOLD that line —
 *      do renders QUEUE rather than spawn browsers, and does memory return to
 *      baseline after a burst (no leak)?
 *   3. BLAST RADIUS: while the pool is saturated, does the worker still process
 *      a payment-webhook activation and a notification send in acceptable time,
 *      or does render pressure starve the other consumers? The worker is
 *      SHARED — a render-induced OOM takes payments and notifications with it.
 *
 * Method: boot the real worker as a child process, drive GENERATE_RESUME and
 * RENDER_INVOICE jobs at increasing concurrency, and sample the whole PROCESS
 * TREE's working set (Node + every Chromium child) throughout.
 *
 * External providers: NONE are contacted. Notification sends resolve to
 * MockWhatsappChannel / MockEmailChannel; PDFs are written to local MinIO.
 *
 *   pnpm load:chromium
 *   RENDER_POOL_CONCURRENCY=4 RESUME_RENDER_CONCURRENCY=4 pnpm load:chromium
 *   LOAD_LEVELS=1,2,4,8,16,32 LOAD_MEMORY_LIMIT_MB=1024 pnpm load:chromium
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  NotificationType,
  PrismaClient,
  ResumeGenerationStatus,
  ResumeTrigger,
} from '@prisma/client';
import { Queue } from 'bullmq';
import {
  REPO_ROOT,
  TreeMemorySampler,
  loadRootEnv,
  mb,
  sleep,
  startWorker,
  stats,
  table,
  waitFor,
} from './lib/harness';

loadRootEnv(); // before PrismaClient/Queue construction — they read env eagerly

const prisma = new PrismaClient();

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const LEVELS = (process.env.LOAD_LEVELS ?? '1,2,4,8,16,32').split(',').map(Number);
/** The container memory limit we are sizing against (worker-and-external-sends). */
const MEMORY_LIMIT_MB = Number(process.env.LOAD_MEMORY_LIMIT_MB ?? 1024);
/** Fraction of the limit past which we call the configuration unsafe. */
const UNSAFE_FRACTION = 0.8;

/** Held constant across levels — invoice renders share the pool but are not the variable. */
const INVOICE_RENDER_CONCURRENCY = process.env.INVOICE_RENDER_CONCURRENCY ?? '1';

const resumeQueue = new Queue('resume-render', { connection: { url: REDIS_URL } });
const notificationQueue = new Queue('notification', { connection: { url: REDIS_URL } });

interface LevelResult {
  concurrency: number;
  renders: number;
  ok: number;
  failed: number;
  wallMs: number;
  throughputPerMin: number;
  renderP50: number;
  renderP95: number;
  renderMax: number;
  peakTreeMB: number;
  peakChromiumMB: number;
  peakProcs: number;
  settledMB: number;
  verdict: string;
}

// ─────── Fixtures ───────────────────────────────────────────────────────────

/** Ensure `n` load candidates have a CandidateResume row to generate against. */
async function ensureResumes(n: number): Promise<string[]> {
  const candidates = await prisma.candidateProfile.findMany({
    where: { user: { email: { endsWith: '@loadtest.local' } } },
    select: { id: true },
    take: n,
    orderBy: { id: 'asc' },
  });
  if (candidates.length < n) {
    throw new Error(`need ${n} load candidates, found ${candidates.length} — run \`pnpm load:seed\``);
  }
  const existing = await prisma.candidateResume.findMany({
    where: { candidateId: { in: candidates.map((c) => c.id) } },
    select: { candidateId: true, id: true },
  });
  const have = new Map(existing.map((r) => [r.candidateId, r.id]));
  const missing = candidates.filter((c) => !have.has(c.id));
  if (missing.length) {
    await prisma.candidateResume.createMany({
      data: missing.map((c) => ({ candidateId: c.id })),
      skipDuplicates: true,
    });
    const created = await prisma.candidateResume.findMany({
      where: { candidateId: { in: missing.map((c) => c.id) } },
      select: { candidateId: true, id: true },
    });
    for (const r of created) have.set(r.candidateId, r.id);
  }
  return candidates.map((c) => have.get(c.id)!);
}

/** Create `count` PENDING generations and enqueue them all at once (the burst). */
async function enqueueBurst(resumeIds: string[], count: number): Promise<string[]> {
  const ids: string[] = [];
  const rows = Array.from({ length: count }, (_, i) => {
    const resumeId = resumeIds[i % resumeIds.length]!;
    return {
      resumeId,
      status: ResumeGenerationStatus.PENDING,
      trigger: ResumeTrigger.DOWNLOAD,
      settingsSnapshot: {
        language: 'en',
        showPhone: true,
        showReligion: false,
        showFatherName: true,
        showPassportNumber: false,
      },
    };
  });
  // createMany does not return ids — create in a transaction of creates instead.
  const created = await prisma.$transaction(
    rows.map((data) => prisma.resumeGeneration.create({ data, select: { id: true, resumeId: true } })),
  );
  for (const g of created) ids.push(g.id);

  await resumeQueue.addBulk(
    created.map((g, i) => ({
      name: 'generate-resume',
      data: { generationId: g.id, candidateId: resumeIds[i % resumeIds.length]! },
      opts: {
        // The production opts (S7-B1). Retries stay on so a timeout-killed
        // render is observed exactly as production would observe it.
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 10_000 },
        removeOnComplete: true,
      },
    })),
  );
  return ids;
}

// ─────── Blast radius ───────────────────────────────────────────────────────

/**
 * Enqueue ONE notification job and measure how long the worker takes to drain
 * it. Run at idle for a baseline, then again mid-burst: the delta IS the
 * starvation measurement.
 */
async function probeNotificationLatency(userId: string): Promise<number> {
  // The EMAIL channel is the clean signal: NotificationProcessor.sendEmailDirect
  // writes an email_messages row, so a new row for this user means the worker
  // actually picked the job up and ran it. (The in-app notifications row is
  // written by the API's NotificationService, not the worker — counting that
  // would measure nothing.) The channel resolves to MockEmailChannel.
  const before = await prisma.emailMessage.count({ where: { userId } });
  const started = Date.now();
  await notificationQueue.add(
    'send-notification',
    {
      userId,
      type: NotificationType.SUBSCRIPTION_PURCHASED,
      channel: 'email',
      payload: {
        title: 'Blast-radius probe',
        body: 'Measuring worker responsiveness under render pressure.',
        data: { probe: true },
      },
    },
    { removeOnComplete: true },
  );
  await waitFor(
    async () => (await prisma.emailMessage.count({ where: { userId } })) > before,
    120_000,
    100,
    'notification probe to be processed',
  );
  return Date.now() - started;
}

// ─────── Level runner ───────────────────────────────────────────────────────

async function runLevel(
  concurrency: number,
  renders: number,
  resumeIds: string[],
  sampler: TreeMemorySampler,
  probeUserId: string | null,
  isDead?: () => boolean,
): Promise<{ level: LevelResult; blastMs: number | null }> {
  const t0 = Date.now();
  const generationIds = await enqueueBurst(resumeIds, renders);

  // Probe the OTHER consumer while the render queue is saturated.
  let blastMs: number | null = null;
  const blastProbe = (async () => {
    if (!probeUserId) return;
    await sleep(1_500); // let the pool fill first
    try {
      blastMs = await probeNotificationLatency(probeUserId);
    } catch {
      blastMs = -1; // never drained — full starvation
    }
  })();

  await waitFor(
    async () => {
      // A dead worker will never drain the queue — fail fast rather than sit
      // out the full timeout. This is the OOM path we are hunting for.
      if (isDead?.()) throw new Error('worker process exited mid-burst');
      const pending = await prisma.resumeGeneration.count({
        where: { id: { in: generationIds }, status: ResumeGenerationStatus.PENDING },
      });
      return pending === 0;
    },
    5 * 60_000,
    500,
    `${renders} renders at concurrency ${concurrency}`,
  );
  const t1 = Date.now();
  await blastProbe;

  const done = await prisma.resumeGeneration.findMany({
    where: { id: { in: generationIds } },
    select: { status: true, createdAt: true, generatedAt: true },
  });
  const ok = done.filter((g) => g.status === ResumeGenerationStatus.READY);
  const failed = done.filter((g) => g.status === ResumeGenerationStatus.FAILED);
  // End-to-end per render: enqueue → READY (includes time queued on the pool).
  const latencies = ok
    .filter((g) => g.generatedAt)
    .map((g) => g.generatedAt!.getTime() - g.createdAt.getTime());
  const l = stats(latencies);

  const peak = sampler.peakBetween(t0, t1);

  // Post-burst settle: the leak check. Memory must come back down once idle.
  await sleep(12_000);
  const settled = sampler.latest();

  const peakMB = peak ? mb(peak.totalBytes) : NaN;
  const verdict =
    failed.length > 0
      ? `DEGRADED — ${failed.length} render(s) failed`
      : peakMB > MEMORY_LIMIT_MB * UNSAFE_FRACTION
        ? `UNSAFE — peak ${peakMB}MB > ${Math.round(MEMORY_LIMIT_MB * UNSAFE_FRACTION)}MB`
        : 'OK';

  return {
    level: {
      concurrency,
      renders,
      ok: ok.length,
      failed: failed.length,
      wallMs: t1 - t0,
      throughputPerMin: Math.round((ok.length / (t1 - t0)) * 60_000),
      renderP50: Math.round(l.p50),
      renderP95: Math.round(l.p95),
      renderMax: Math.round(l.max),
      peakTreeMB: peakMB,
      peakChromiumMB: peak ? mb(peak.chromiumBytes) : NaN,
      peakProcs: peak?.procCount ?? 0,
      settledMB: settled ? mb(settled.totalBytes) : NaN,
      verdict,
    },
    blastMs,
  };
}

// ─────── Main ───────────────────────────────────────────────────────────────

interface PhaseRun {
  phase: string;
  poolCap: number;
  queueConcurrency: number;
  baselineMB: number | null;
  idleBlastMs: number | null;
  blastMs: number | null;
  level: LevelResult;
  poolEvents: string[];
  workerDied: boolean;
}

/**
 * One measured run against a FRESH worker.
 *
 * A fresh worker per level is not tidiness — BullMQ's `concurrency` and the
 * pool's cap are both fixed at process start, so varying them without a restart
 * is impossible. It also gives every level an uncontaminated memory baseline.
 *
 * A warm-up burst runs before the measured one: the first render of a process
 * pays Chromium launch, V8 JIT and Prisma's cold query path, which would
 * otherwise be charged to whichever level happens to run first.
 */
async function runPhaseLevel(
  phase: string,
  poolCap: number,
  queueConcurrency: number,
  resumeIds: string[],
  probeUserId: string | null,
): Promise<PhaseRun> {
  const renders = Math.max(queueConcurrency * 4, 24);
  console.log(
    `\n▶ ${phase}: poolCap=${poolCap} queueConcurrency=${queueConcurrency} (${renders} renders)`,
  );

  const worker = await startWorker({
    RENDER_POOL_CONCURRENCY: String(poolCap),
    RESUME_RENDER_CONCURRENCY: String(queueConcurrency),
    INVOICE_RENDER_CONCURRENCY: String(INVOICE_RENDER_CONCURRENCY),
  });
  const sampler = new TreeMemorySampler(worker.pid, 400);
  sampler.start();
  await sleep(3_500);
  const baseline = sampler.latest();

  const idleBlastMs = probeUserId ? await probeNotificationLatency(probeUserId) : null;

  const isDead = () => worker.proc.exitCode !== null;

  // Warm-up (not measured): pays browser launch + JIT + cold Prisma.
  await runLevel(queueConcurrency, 4, resumeIds, sampler, null, isDead);

  let run: { level: LevelResult; blastMs: number | null };
  try {
    run = await runLevel(queueConcurrency, renders, resumeIds, sampler, probeUserId, isDead);
  } catch (err) {
    // A worker that OOMs mid-burst never drains the queue — that IS the result.
    const died = worker.proc.exitCode !== null;
    console.error(`  ✗ ${died ? `WORKER DIED (exit ${worker.proc.exitCode})` : 'level failed'}: ${String(err)}`);
    const peak = sampler.samples.length
      ? sampler.samples.reduce((a, b) => (b.totalBytes > a.totalBytes ? b : a))
      : null;
    run = {
      level: {
        concurrency: queueConcurrency, renders, ok: 0, failed: renders, wallMs: -1,
        throughputPerMin: 0, renderP50: NaN, renderP95: NaN, renderMax: NaN,
        peakTreeMB: peak ? mb(peak.totalBytes) : NaN,
        peakChromiumMB: peak ? mb(peak.chromiumBytes) : NaN,
        peakProcs: peak?.procCount ?? 0, settledMB: NaN,
        verdict: died ? 'WORKER DIED' : 'DID NOT DRAIN',
      },
      blastMs: null,
    };
  }

  const poolEvents = worker.lines
    .filter((l) => /chromium launched|recycling|force-killing|disconnected/.test(l.line))
    .map((l) => l.line.replace(/\[[0-9;]*m/g, ''));
  const workerDied = worker.proc.exitCode !== null;

  sampler.stop();
  await worker.stop();

  const { level, blastMs } = run;
  console.log(
    `  ok=${level.ok} failed=${level.failed} p50=${level.renderP50}ms p95=${level.renderP95}ms ` +
      `throughput=${level.throughputPerMin}/min`,
  );
  console.log(
    `  memory: baseline=${baseline ? mb(baseline.totalBytes) : '?'}MB peak=${level.peakTreeMB}MB ` +
      `(chromium ${level.peakChromiumMB}MB across ${level.peakProcs} procs) settled=${level.settledMB}MB → ${level.verdict}`,
  );
  if (blastMs !== null && idleBlastMs) {
    console.log(
      `  blast radius: notification ${blastMs}ms under load vs ${idleBlastMs}ms idle ` +
        `(${(blastMs / idleBlastMs).toFixed(1)}× )`,
    );
  }

  return { phase, poolCap, queueConcurrency, baselineMB: baseline ? mb(baseline.totalBytes) : null,
    idleBlastMs, blastMs, level, poolEvents, workerDied };
}

/**
 * SOAK — the leak test, and the confirmation run for a tuned configuration.
 *
 * The sweep above starts a fresh worker per level, so its "settled" numbers say
 * nothing about a LONG-LIVED worker: a leak only shows up across repeated
 * bursts on one process. This drives N consecutive bursts against a single
 * worker at the recommended production config and reports peak and settled
 * memory after each. Settled memory must not climb monotonically, and the
 * browser recycle (every RENDER_RECYCLE_AFTER renders) must fire along the way.
 */
async function soak(resumeIds: string[], probeUserId: string | null): Promise<void> {
  const cap = Number(process.env.RENDER_POOL_CONCURRENCY ?? 2);
  const q = Number(process.env.RESUME_RENDER_CONCURRENCY ?? 1);
  const bursts = Number(process.env.LOAD_SOAK_BURSTS ?? 5);
  const perBurst = Number(process.env.LOAD_SOAK_RENDERS ?? 30);

  console.log(`══ SOAK — ${bursts} consecutive bursts × ${perBurst} renders on ONE worker ══`);
  console.log(`  config: poolCap=${cap} resumeQ=${q} invoiceQ=${INVOICE_RENDER_CONCURRENCY}\n`);

  const worker = await startWorker({
    RENDER_POOL_CONCURRENCY: String(cap),
    RESUME_RENDER_CONCURRENCY: String(q),
    INVOICE_RENDER_CONCURRENCY: String(INVOICE_RENDER_CONCURRENCY),
  });
  const sampler = new TreeMemorySampler(worker.pid, 400);
  sampler.start();
  await sleep(3_500);
  const baseline = sampler.latest();
  console.log(`  baseline (no browser yet): ${baseline ? mb(baseline.totalBytes) : '?'}MB`);

  const rows: Record<string, unknown>[] = [];
  const isDead = () => worker.proc.exitCode !== null;
  for (let i = 1; i <= bursts; i++) {
    const { level, blastMs } = await runLevel(q, perBurst, resumeIds, sampler, probeUserId, isDead);
    rows.push({
      burst: i,
      ok: level.ok,
      failed: level.failed,
      p50ms: level.renderP50,
      p95ms: level.renderP95,
      peakMB: level.peakTreeMB,
      settledMB: level.settledMB,
      procs: level.peakProcs,
      notificationMs: blastMs,
    });
    console.log(
      `  burst ${i}: ok=${level.ok} failed=${level.failed} peak=${level.peakTreeMB}MB ` +
        `settled=${level.settledMB}MB notification=${blastMs}ms`,
    );
    if (isDead()) {
      console.error(`  ✗ worker died during burst ${i}`);
      break;
    }
  }

  const events = worker.lines
    .filter((l) => /chromium launched|recycling|force-killing|disconnected/.test(l.line))
    .map((l) => l.line.replace(/\[[0-9;]*m/g, '').replace(/.*\[BrowserPoolService\]\s*/, '').trim());

  sampler.stop();
  await worker.stop();

  console.log('\n── soak results ──');
  table(rows);
  const settled = rows.map((r) => Number(r.settledMB)).filter(Number.isFinite);
  const drift = settled.length > 1 ? settled[settled.length - 1]! - settled[0]! : 0;
  console.log(
    `\nsettled-memory drift across ${settled.length} bursts: ${drift >= 0 ? '+' : ''}${drift}MB ` +
      `(${settled.join(' → ')}MB)`,
  );
  console.log('pool lifecycle events:');
  for (const e of events) console.log(`  ${e}`);

  const outDir = path.join(REPO_ROOT, 'load', 'results');
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `chromium-pool-soak-${Date.now()}.json`);
  writeFileSync(
    out,
    JSON.stringify(
      { config: { cap, q, invoiceQ: INVOICE_RENDER_CONCURRENCY, bursts, perBurst },
        baselineMB: baseline ? mb(baseline.totalBytes) : null, rows, driftMB: drift, events },
      null,
      2,
    ),
  );
  console.log(`\nfull results → ${path.relative(REPO_ROOT, out)}`);
}

async function main() {
  console.log('S8-H1 — Chromium pool burst');
  console.log(`  memory limit under test: ${MEMORY_LIMIT_MB}MB   levels: [${LEVELS}]`);
  console.log('  external providers: WhatsApp/email = MOCK channels; storage = local MinIO;');
  console.log('  no live Meta / SES / Razorpay call is made by this script.\n');

  const resumeIds = await ensureResumes(64);
  const probeUser = await prisma.user.findFirst({
    where: { email: { endsWith: '@loadtest.local' }, role: 'CANDIDATE' },
    select: { id: true },
  });

  if (process.env.LOAD_MODE === 'soak') {
    await soak(resumeIds, probeUser?.id ?? null);
    await resumeQueue.close();
    await notificationQueue.close();
    await prisma.$disconnect();
    return;
  }

  const runs: PhaseRun[] = [];

  // ── Phase A — does the CAP HOLD THE LINE? ────────────────────────────────
  // Pool cap pinned at the S7-B1 value of 2 while the number of render jobs in
  // flight climbs far past it. If the semaphore works, memory and the Chromium
  // process count stay FLAT as concurrency rises — the extra renders queue
  // instead of spawning pages. A rising peak here would mean the cap leaks.
  console.log('══ Phase A — pool cap pinned at 2, queue concurrency climbing ══');
  for (const c of LEVELS) {
    runs.push(await runPhaseLevel('A/cap-holds', 2, c, resumeIds, probeUser?.id ?? null));
  }

  // ── Phase B — WHERE IS THE CEILING? ───────────────────────────────────────
  // Now raise the cap itself in lockstep so renders really do run in parallel,
  // and find the concurrency at which the process tree approaches the limit.
  console.log('\n══ Phase B — pool cap raised in lockstep (finding the ceiling) ══');
  for (const c of LEVELS) {
    const r = await runPhaseLevel('B/ceiling', c, c, resumeIds, probeUser?.id ?? null);
    runs.push(r);
    if (r.workerDied) {
      console.log('  stopping phase B — the worker died, the ceiling is below this level');
      break;
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log('\n── results ──');
  table(
    runs.map((r) => ({
      phase: r.phase,
      poolCap: r.poolCap,
      queueConc: r.queueConcurrency,
      ok: r.level.ok,
      failed: r.level.failed,
      p50ms: r.level.renderP50,
      p95ms: r.level.renderP95,
      perMin: r.level.throughputPerMin,
      baseMB: r.baselineMB,
      peakMB: r.level.peakTreeMB,
      chromeMB: r.level.peakChromiumMB,
      procs: r.level.peakProcs,
      settledMB: r.level.settledMB,
      verdict: r.level.verdict,
    })),
  );

  console.log('\n── blast radius: notification drain time under render saturation ──');
  table(
    runs.map((r) => ({
      phase: r.phase,
      poolCap: r.poolCap,
      queueConc: r.queueConcurrency,
      idleMs: r.idleBlastMs,
      underLoadMs: r.blastMs,
      ratio: r.blastMs && r.idleBlastMs ? Number((r.blastMs / r.idleBlastMs).toFixed(1)) : null,
    })),
  );

  const outDir = path.join(REPO_ROOT, 'load', 'results');
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `chromium-pool-burst-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify({ memoryLimitMB: MEMORY_LIMIT_MB, levels: LEVELS, runs }, null, 2));
  console.log(`\nfull results → ${path.relative(REPO_ROOT, out)}`);

  await resumeQueue.close();
  await notificationQueue.close();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
