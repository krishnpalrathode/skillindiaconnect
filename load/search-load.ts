/**
 * S8-H1 — public search (SSR + FTS) load test: the highest-traffic public path.
 *
 * Drives `GET /api/v1/jobs` (the FTS/trgm search) and `GET /api/v1/jobs/{id}`
 * over the seeded corpus (~10k ACTIVE jobs) with autocannon, and reports
 * p50/p95/p99, throughput, the Redis search-cache hit rate, and the query plan
 * of the hot raw query at volume.
 *
 * Two query MIXES are run, because they measure different things:
 *   - "hot"  : a small set of repeated query shapes — what a real landing page
 *              and popular filters look like. This is the CACHE's best case.
 *   - "cold" : a wide spread of distinct terms — every request misses the cache
 *              and hits Postgres. This is the FTS query's true cost.
 * Reporting only the hot mix would flatter the system; only the cold mix would
 * libel it. Both are recorded.
 *
 * The rate limiter is raised for the run (RATE_LIMIT_SEARCH_PER_MIN) — at the
 * contract's 30/min a load test measures the throttler, not the search path.
 * The contract default is unchanged in code.
 *
 *   pnpm load:search
 *   LOAD_SEARCH_CONNECTIONS=10,25,50,100 LOAD_SEARCH_DURATION=20 pnpm load:search
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ChildProcess, spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { API_DIST, REPO_ROOT, loadRootEnv, sleep, stats, table } from './lib/harness';

loadRootEnv();

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

const PORT = Number(process.env.LOAD_API_PORT ?? 3101);
const BASE = `http://127.0.0.1:${PORT}`;
const CONNECTIONS = (process.env.LOAD_SEARCH_CONNECTIONS ?? '10,25,50,100').split(',').map(Number);
const DURATION = Number(process.env.LOAD_SEARCH_DURATION ?? 15);

/** Repeated shapes — a landing page and its popular filters. Cache-friendly. */
const HOT_PATHS = [
  '/api/v1/jobs',
  '/api/v1/jobs?sort=recent',
  '/api/v1/jobs?market=GULF',
  '/api/v1/jobs?q=electrician',
  '/api/v1/jobs?q=welder&market=GULF',
  '/api/v1/jobs?badge=featured',
];

/** Wide spread — a distinct term per request, so every one misses the cache. */
const COLD_TERMS = [
  'electrician', 'welder', 'plumber', 'mason', 'carpenter', 'painter', 'scaffolder',
  'crane', 'hvac', 'driver', 'machinist', 'refrigeration', 'storekeeper', 'security',
  'supervisor', 'safety', 'fitter', 'mechanic', 'housekeeping', 'steel',
  'dubai', 'doha', 'riyadh', 'muscat', 'jeddah', 'abu dhabi', 'kuwait', 'manama',
  'blueprint', 'hydraulics', 'forklift', 'inspection', 'welding', 'wiring',
];

interface Row {
  mix: string;
  connections: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  non2xx: number;
  errors: number;
  cacheHitRatePct: number | null;
}

// ─────── API process ────────────────────────────────────────────────────────

async function startApi(env: Record<string, string>): Promise<ChildProcess> {
  const proc = spawn(process.execPath, [path.join(API_DIST, 'main.api.js')], {
    env: { ...process.env, ...env, PORT: String(PORT) },
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
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return proc;
    } catch {
      /* not listening yet */
    }
    await sleep(300);
  }
  proc.kill('SIGKILL');
  throw new Error(`API did not become healthy:\n${log.join('')}`);
}

// ─────── Redis cache-hit accounting ─────────────────────────────────────────

/**
 * Redis keyspace hits/misses delta across the run. The API is the only client
 * against this Redis while the test runs, so the delta is attributable to it.
 * It counts ALL key reads (search + detail + throttle + jti checks), so it is
 * an approximation of the search-cache hit rate, not a precise one — the exact
 * search-key measurement is the `search:*` key count reported alongside it.
 */
async function keyspaceStats(): Promise<{ hits: number; misses: number }> {
  const info = await redis.info('stats');
  const hits = Number(/keyspace_hits:(\d+)/.exec(info)?.[1] ?? 0);
  const misses = Number(/keyspace_misses:(\d+)/.exec(info)?.[1] ?? 0);
  return { hits, misses };
}

async function countSearchKeys(): Promise<number> {
  let cursor = '0';
  let n = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'search:*', 'COUNT', 500);
    cursor = next;
    n += keys.length;
  } while (cursor !== '0');
  return n;
}

// ─────── EXPLAIN ANALYZE at volume ──────────────────────────────────────────

/**
 * The hot raw query from JobsSearchService.runSearch, EXPLAIN ANALYZE'd against
 * the real corpus. A plan that is fine over 10 rows can seq-scan over 10k; this
 * is where a missing GIN/trgm index shows up.
 *
 * ⚠️ This is a HAND-COPY of the service's SQL — EXPLAIN needs the statement text,
 * and Prisma.sql fragments are assembled privately inside the service. If the
 * WHERE/ORDER BY in JobsSearchService.runSearch changes, change it here too, or
 * this will cheerfully report the plan of a query nobody runs.
 */
async function explainHotQuery(q: string): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
    `EXPLAIN (ANALYZE, BUFFERS)
     SELECT j.id, j."publishedAt", j."salaryMax",
            ts_rank(j."searchVector", websearch_to_tsquery('english', $1)) AS rank
     FROM jobs j
     LEFT JOIN job_categories jc ON jc.id = j."categoryId"
     WHERE j.status = 'ACTIVE'
       AND (j."searchVector" @@ websearch_to_tsquery('english', $1)
            OR j.title % $1)
     ORDER BY ts_rank(j."searchVector", websearch_to_tsquery('english', $1)) DESC,
              j."publishedAt" DESC, j.id DESC
     LIMIT 21`,
    q,
  );
  return rows.map((r) => r['QUERY PLAN']);
}

async function explainRecentQuery(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
    `EXPLAIN (ANALYZE, BUFFERS)
     SELECT j.id, j."publishedAt", j."salaryMax", 0::float4 AS rank
     FROM jobs j
     LEFT JOIN job_categories jc ON jc.id = j."categoryId"
     WHERE j.status = 'ACTIVE'
     ORDER BY j."publishedAt" DESC, j.id DESC
     LIMIT 21`,
  );
  return rows.map((r) => r['QUERY PLAN']);
}

// ─────── Runner ─────────────────────────────────────────────────────────────

/**
 * Closed-loop driver: `connections` workers, each looping GET requests over the
 * path list for `durationS`, recording every latency.
 *
 * Hand-rolled rather than autocannon because autocannon's summary exposes p50 /
 * p90 / p97.5 / p99 but NOT p95 — and p95 is the number this unit is required to
 * report. Keeping the raw samples also makes the search results directly
 * comparable with the webhook and apply scripts, which drive load the same way.
 * Node 22's fetch keeps connections alive via undici by default.
 */
async function drive(
  paths: string[],
  connections: number,
  durationS: number,
): Promise<{ latencies: number[]; non2xx: number; errors: number; wallMs: number }> {
  const latencies: number[] = [];
  let non2xx = 0;
  let errors = 0;
  const deadline = Date.now() + durationS * 1000;
  const t0 = Date.now();

  await Promise.all(
    Array.from({ length: connections }, async (_, worker) => {
      let i = worker; // stagger start offsets so workers don't march in lockstep
      while (Date.now() < deadline) {
        const url = `${BASE}${paths[i++ % paths.length]}`;
        const started = Date.now();
        try {
          const res = await fetch(url);
          await res.arrayBuffer(); // drain, or the connection is not reusable
          latencies.push(Date.now() - started);
          if (res.status < 200 || res.status >= 300) non2xx++;
        } catch {
          errors++;
        }
      }
    }),
  );
  return { latencies, non2xx, errors, wallMs: Date.now() - t0 };
}

async function runMix(mix: 'hot' | 'cold' | 'detail', connections: number, paths: string[]): Promise<Row> {
  const before = await keyspaceStats();
  const { latencies, non2xx, errors, wallMs } = await drive(paths, connections, DURATION);
  const after = await keyspaceStats();

  const dHits = after.hits - before.hits;
  const dMisses = after.misses - before.misses;
  const hitRate = dHits + dMisses > 0 ? (dHits / (dHits + dMisses)) * 100 : null;
  const l = stats(latencies);

  return {
    mix,
    connections,
    rps: Math.round((latencies.length / wallMs) * 1000),
    p50: Math.round(l.p50),
    p95: Math.round(l.p95),
    p99: Math.round(l.p99),
    max: Math.round(l.max),
    non2xx,
    errors,
    cacheHitRatePct: hitRate === null ? null : Math.round(hitRate * 10) / 10,
  };
}

async function main() {
  console.log('S8-H1 — public search load test');
  console.log('  external providers: none contacted (this path is DB + Redis only)\n');

  const activeJobs = await prisma.job.count({ where: { status: 'ACTIVE' } });
  console.log(`corpus: ${activeJobs} ACTIVE jobs`);
  if (activeJobs < 1_000) {
    console.warn('⚠ fewer than 1000 active jobs — run `pnpm load:seed`; results will not be meaningful');
  }

  // ── Query plans at volume, BEFORE the load (a clean plan, no contention) ──
  console.log('\n── EXPLAIN ANALYZE at volume ──');
  const ftsPlan = await explainHotQuery('electrician');
  console.log('FTS + trgm search (q=electrician):');
  for (const line of ftsPlan) console.log('  ' + line);
  const recentPlan = await explainRecentQuery();
  console.log('\nUnfiltered recent sort (the landing page):');
  for (const line of recentPlan) console.log('  ' + line);

  const detailIds = (
    await prisma.job.findMany({ where: { status: 'ACTIVE' }, select: { id: true }, take: 50 })
  ).map((j) => j.id);

  const api = await startApi({
    // Raise the limiter so we measure the search path, not the throttler.
    RATE_LIMIT_SEARCH_PER_MIN: process.env.RATE_LIMIT_SEARCH_PER_MIN ?? '1000000',
    RATE_LIMIT_GLOBAL_PER_MIN: process.env.RATE_LIMIT_GLOBAL_PER_MIN ?? '1000000',
  });
  console.log(`\nAPI up on ${BASE} (pid ${api.pid})`);

  const rows: Row[] = [];
  try {
    for (const c of CONNECTIONS) {
      console.log(`\n▶ ${c} connections, ${DURATION}s each`);

      const hot = await runMix('hot', c, HOT_PATHS);
      console.log(`  hot   : ${hot.rps} rps  p50=${hot.p50}ms p95=${hot.p95}ms p99=${hot.p99}ms  cache≈${hot.cacheHitRatePct}%`);
      rows.push(hot);

      const cold = await runMix(
        'cold',
        c,
        COLD_TERMS.map((t) => `/api/v1/jobs?q=${encodeURIComponent(t)}`),
      );
      console.log(`  cold  : ${cold.rps} rps  p50=${cold.p50}ms p95=${cold.p95}ms p99=${cold.p99}ms  cache≈${cold.cacheHitRatePct}%`);
      rows.push(cold);

      const detail = await runMix(
        'detail',
        c,
        detailIds.map((id) => `/api/v1/jobs/${id}`),
      );
      console.log(`  detail: ${detail.rps} rps  p50=${detail.p50}ms p95=${detail.p95}ms p99=${detail.p99}ms`);
      rows.push(detail);

      if (hot.non2xx > 0 || cold.non2xx > 0 || detail.non2xx > 0) {
        console.warn(`  ⚠ non-2xx responses: hot=${hot.non2xx} cold=${cold.non2xx} detail=${detail.non2xx}`);
      }
    }
  } finally {
    const searchKeys = await countSearchKeys();
    api.kill('SIGTERM');
    await sleep(1_500);
    if (api.exitCode === null) api.kill('SIGKILL');

    console.log('\n── results ──');
    table(rows as unknown as Record<string, unknown>[]);
    console.log(`\ndistinct search:* cache keys in Redis after the run: ${searchKeys}`);

    const outDir = path.join(REPO_ROOT, 'load', 'results');
    mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `search-load-${Date.now()}.json`);
    writeFileSync(
      out,
      JSON.stringify({ activeJobs, connections: CONNECTIONS, durationS: DURATION, rows, ftsPlan, recentPlan, searchKeys }, null, 2),
    );
    console.log(`full results → ${path.relative(REPO_ROOT, out)}`);

    await redis.quit();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
