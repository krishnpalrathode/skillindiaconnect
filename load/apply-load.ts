/**
 * S8-H1 — the apply path (POST /api/v1/jobs/{id}/apply) under concurrency.
 *
 * This is the transactional candidate path: five sequential gates, a match
 * score computed once and snapshotted, and an insert guarded by the
 * `@@unique([jobId, candidateId])` constraint.
 *
 * Two scenarios:
 *   1. SPREAD — distinct (candidate, job) pairs at rising concurrency. Measures
 *      the real cost of gate evaluation + match compute + insert, and where DB
 *      contention starts to bend the latency curve.
 *   2. THE RACE — N simultaneous applies from the SAME candidate to the SAME
 *      job. The gate's `findUnique` pre-check cannot prevent this (it is a read
 *      before a write); the DB unique constraint is the actual guarantee.
 *      EXACTLY ONE row must exist afterwards, the rest must get 409
 *      ALREADY_APPLIED. Run at several widths.
 *
 * Auth: access tokens are minted directly (see harness.mintAccessToken) because
 * POST /auth/login is rate-limited to 5/min/IP — logging in 2000 candidates
 * would measure the throttler.
 *
 * External providers: none. Apply enqueues notifications; the worker is not
 * running in this test, so nothing is sent at all.
 *
 *   pnpm load:apply
 *   LOAD_APPLY_CONCURRENCY=1,10,25,50 LOAD_APPLY_PER_LEVEL=200 pnpm load:apply
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ChildProcess, spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import {
  API_DIST,
  REPO_ROOT,
  loadRootEnv,
  mintAccessToken,
  sleep,
  stats,
  table,
} from './lib/harness';

loadRootEnv();

const prisma = new PrismaClient();

const PORT = Number(process.env.LOAD_API_PORT ?? 3103);
const BASE = `http://127.0.0.1:${PORT}`;
const CONCURRENCIES = (process.env.LOAD_APPLY_CONCURRENCY ?? '1,10,25,50').split(',').map(Number);
const PER_LEVEL = Number(process.env.LOAD_APPLY_PER_LEVEL ?? 200);
const RACE_WIDTHS = (process.env.LOAD_APPLY_RACE_WIDTHS ?? '2,5,10,25,50').split(',').map(Number);

interface ApplyResult {
  status: number;
  ms: number;
  code?: string;
}

async function apply(jobId: string, token: string): Promise<ApplyResult> {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/v1/jobs/${jobId}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ coverLetter: 'Load test application. Available to join immediately.' }),
  });
  const ms = Date.now() - started;
  let code: string | undefined;
  try {
    const body = (await res.json()) as { code?: string };
    code = body?.code;
  } catch {
    /* empty body */
  }
  return { status: res.status, ms, code };
}

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

async function startApi(): Promise<ChildProcess> {
  const proc = spawn(process.execPath, [path.join(API_DIST, 'main.api.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      // Measure the apply path, not the global 100/min limiter.
      RATE_LIMIT_GLOBAL_PER_MIN: process.env.RATE_LIMIT_GLOBAL_PER_MIN ?? '1000000',
    },
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

/**
 * Candidates who have NOT applied to the chosen jobs yet. The seeder already
 * created 50k applications, so pairs must be picked with care or every request
 * would short-circuit on ALREADY_APPLIED and measure gate 2 instead of the
 * whole path.
 */
async function freshPairs(count: number): Promise<{ jobId: string; token: string; candidateId: string }[]> {
  // Over-fetch on BOTH sides. A candidate is only usable if some job in the
  // pool is one they have not already applied to, so the pools must be much
  // larger than `count` — sizing them at `count` starves the search immediately
  // (and sizing the JOB pool off `count` makes freshPairs(1) look at two jobs).
  const users = await prisma.user.findMany({
    where: { email: { endsWith: '@loadtest.local' }, role: 'CANDIDATE', candidateProfile: { isNot: null } },
    select: { id: true, email: true, candidateProfile: { select: { id: true } } },
    take: Math.max(count * 5, 500),
    orderBy: { email: 'desc' }, // the high-numbered tail: fewest seeded applications
  });
  const jobs = await prisma.job.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
    take: 500,
    orderBy: { createdAt: 'desc' },
  });

  // ONE query for every candidate's existing applications, not one per candidate:
  // per-candidate lookups over a 500-user pool made fixture setup slower than the
  // load test it was setting up.
  const candidateIds = users.map((u) => u.candidateProfile!.id);
  const taken = new Map<string, Set<string>>(candidateIds.map((id) => [id, new Set<string>()]));
  for (const a of await prisma.application.findMany({
    where: { candidateId: { in: candidateIds } },
    select: { candidateId: true, jobId: true },
  })) {
    taken.get(a.candidateId!)?.add(a.jobId);
  }

  // Each chosen job is also reserved in-memory, so two pairs in the same batch
  // never target the same (candidate, job) — that would turn the spread test
  // into an accidental race test.
  const pairs: { jobId: string; token: string; candidateId: string }[] = [];
  for (const u of users) {
    const candidateId = u.candidateProfile!.id;
    const used = taken.get(candidateId)!;
    const job = jobs.find((j) => !used.has(j.id));
    if (!job) continue;
    used.add(job.id);
    pairs.push({ jobId: job.id, candidateId, token: mintAccessToken(u.id, u.email, 'CANDIDATE') });
    if (pairs.length >= count) break;
  }
  return pairs;
}

async function main() {
  console.log('S8-H1 — apply + match load test');
  console.log('  external providers: none contacted (the worker is not running in this test).\n');

  const api = await startApi();
  console.log(`API up on ${BASE} (pid ${api.pid})`);

  const spreadRows: Record<string, unknown>[] = [];
  const raceRows: Record<string, unknown>[] = [];

  try {
    // ── 1. SPREAD: distinct pairs at rising concurrency ─────────────────────
    console.log('\n══ spread: distinct (candidate, job) pairs ══');
    for (const c of CONCURRENCIES) {
      const pairs = await freshPairs(PER_LEVEL);
      if (pairs.length < PER_LEVEL) {
        console.warn(`  ⚠ only ${pairs.length} fresh pairs available for c=${c}`);
      }
      const t0 = Date.now();
      const results = await pooled(pairs.map((p) => () => apply(p.jobId, p.token)), c);
      const wallMs = Date.now() - t0;

      const created = results.filter((r) => r.status === 201);
      const l = stats(results.map((r) => r.ms));
      const byCode: Record<string, number> = {};
      for (const r of results.filter((x) => x.status !== 201)) {
        byCode[r.code ?? String(r.status)] = (byCode[r.code ?? String(r.status)] ?? 0) + 1;
      }
      const row = {
        concurrency: c,
        requests: results.length,
        created: created.length,
        rps: Math.round((results.length / wallMs) * 1000),
        p50: Math.round(l.p50),
        p95: Math.round(l.p95),
        p99: Math.round(l.p99),
        max: Math.round(l.max),
        nonCreated: JSON.stringify(byCode),
      };
      spreadRows.push(row);
      console.log(
        `  c=${c}: ${row.rps} rps  p50=${row.p50}ms p95=${row.p95}ms p99=${row.p99}ms  ` +
          `created=${created.length}/${results.length} ${Object.keys(byCode).length ? JSON.stringify(byCode) : ''}`,
      );
    }

    // ── 2. THE RACE: same candidate + same job, N at once ───────────────────
    console.log('\n══ race: N simultaneous applies, same candidate → same job ══');
    for (const width of RACE_WIDTHS) {
      const [pair] = await freshPairs(1);
      if (!pair) {
        console.warn('  ⚠ no fresh (candidate, job) pair left — skipping');
        break;
      }
      const before = await prisma.application.count({
        where: { jobId: pair.jobId, candidateId: pair.candidateId },
      });
      const results = await pooled(
        Array.from({ length: width }, () => () => apply(pair.jobId, pair.token)),
        width,
      );
      const after = await prisma.application.count({
        where: { jobId: pair.jobId, candidateId: pair.candidateId },
      });

      const created = results.filter((r) => r.status === 201).length;
      const conflicts = results.filter((r) => r.status === 409).length;
      const other = results.filter((r) => r.status !== 201 && r.status !== 409);
      const l = stats(results.map((r) => r.ms));

      // The invariant: exactly one row, whatever the HTTP mix looked like.
      const verdict =
        after - before === 1 && created === 1 && other.length === 0
          ? 'OK — one row, one 201, rest 409'
          : after - before === 1
            ? `one row, but HTTP mix off (201=${created}, other=${other.map((o) => o.code ?? o.status).join(',')})`
            : `✗ RACE LOST — ${after - before} rows created`;

      const row = {
        width,
        rowsCreated: after - before,
        http201: created,
        http409: conflicts,
        httpOther: other.length ? JSON.stringify(other.map((o) => o.code ?? o.status)) : '',
        p95: Math.round(l.p95),
        max: Math.round(l.max),
        verdict,
      };
      raceRows.push(row);
      console.log(`  width=${width}: rows=${after - before} 201=${created} 409=${conflicts} → ${verdict}`);
    }

    console.log('\n── spread results ──');
    table(spreadRows);
    console.log('\n── race results ──');
    table(raceRows);

    const outDir = path.join(REPO_ROOT, 'load', 'results');
    mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `apply-load-${Date.now()}.json`);
    writeFileSync(out, JSON.stringify({ concurrencies: CONCURRENCIES, perLevel: PER_LEVEL, spreadRows, raceRows }, null, 2));
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
