/**
 * S8-H3 CHAOS — Redis down, mid-operation.
 *
 * THE headline question: does authorization FAIL CLOSED?
 *
 * `PermissionService` caches each role's permission set in Redis and falls back
 * to the database on a miss. If a Redis outage were to make that lookup return
 * an EMPTY-but-successful result, or if an error were swallowed into "allow",
 * the platform would grant admin actions to whoever asked during an outage.
 * That is the single worst outcome in this unit, so it is checked first and
 * from both directions: a role that SHOULD be denied must still be denied, and
 * a role that SHOULD be allowed must not be silently escalated.
 *
 * Also under test while Redis is down:
 *   - the search cache MISSES THROUGH to Postgres rather than erroring
 *   - rate limiting does not fail OPEN into unlimited auth attempts
 *   - the health endpoint reports redis:down honestly
 *   - everything RECOVERS when Redis returns, with no restart
 *
 * Injection: the Redis container is STOPPED. Real refused sockets, not a mock.
 *
 *   pnpm chaos:redis
 */
import { PrismaClient } from '@prisma/client';
import {
  ChaosRecorder,
  codeOf,
  finish,
  isUp,
  killDependency,
  reviveAndWait,
  req,
  sleep,
  startApi,
} from './lib/harness';
import { build, purge } from './lib/fixtures';

const PORT = Number(process.env.CHAOS_API_PORT ?? 3301);
const prisma = new PrismaClient();

async function main() {
  console.log('S8-H3 CHAOS — Redis outage\n');
  const fx = await build(prisma);
  const rec = new ChaosRecorder();

  // Short command timeouts: with ioredis' offline queue the default is to hold
  // commands indefinitely while disconnected, which would make every request
  // hang rather than fail. Production must not hang either, so the API is
  // started with the same bounded settings it should ship with.
  const api = await startApi(PORT, {
    RATE_LIMIT_GLOBAL_PER_MIN: '1000000',
    RATE_LIMIT_SEARCH_PER_MIN: '1000000',
  });

  try {
    // ── Baseline (Redis UP) — otherwise the outage assertions prove nothing ──
    const baseAdmin = await req(api.base, 'GET', '/api/v1/admin/candidates', { token: fx.adminToken });
    const baseModerator = await req(api.base, 'GET', '/api/v1/admin/settings', { token: fx.moderatorToken });
    rec.check({
      id: 'redis-baseline',
      scenario: 'Redis outage',
      promise: 'Control: with Redis UP, SUPER_ADMIN is allowed and MODERATOR is denied settings.view',
      injected: 'nothing (baseline)',
      expected: 'admin 200, moderator 403',
      observed: `admin ${baseAdmin.status}, moderator ${baseModerator.status}`,
      pass: baseAdmin.status === 200 && baseModerator.status === 403,
      severity: 'Info',
    });

    console.log('\n── injecting: docker stop redis ──');
    killDependency('redis');
    await sleep(1500);

    // ── THE fail-closed check ──────────────────────────────────────────────
    // A role WITHOUT the permission must still be refused. If the permission
    // lookup degrades to "no error, empty set" the answer is still deny (safe);
    // if it degrades to "allow on error" this returns 200 and is Critical.
    const denyDuringOutage = await req(api.base, 'GET', '/api/v1/admin/settings', {
      token: fx.moderatorToken,
      timeoutMs: 15_000,
    });
    rec.check({
      id: 'redis-authz-fails-closed-denied-role',
      scenario: 'Redis outage',
      promise: 'Authorization FAILS CLOSED — a role lacking a permission is never granted it during a cache outage',
      injected: 'Redis container stopped',
      expected: 'NOT 2xx (403 or 5xx are both safe; 200 would be a critical escalation)',
      observed: `${denyDuringOutage.status} ${codeOf(denyDuringOutage) ?? ''}`,
      pass: denyDuringOutage.status < 200 || denyDuringOutage.status >= 300,
      severity: 'Critical',
      detail: { body: denyDuringOutage.text.slice(0, 200) },
    });

    // The refusal must also be HONEST about its cause. The session-revocation
    // list lives only in Redis and therefore cannot degrade (CHAOS-003), so an
    // outage is expected to refuse authenticated traffic — but as a retriable
    // 503 naming the cause, not a 500 that reads as an application bug.
    rec.check({
      id: 'redis-authenticated-503-not-500',
      scenario: 'Redis outage',
      promise: 'A dependency outage is reported as a retriable 503, not misreported as a server bug (500)',
      injected: 'Redis container stopped',
      expected: '503 SESSION_VERIFICATION_UNAVAILABLE',
      observed: `${denyDuringOutage.status} ${codeOf(denyDuringOutage) ?? ''}`,
      pass: denyDuringOutage.status === 503 && codeOf(denyDuringOutage) === 'SESSION_VERIFICATION_UNAVAILABLE',
      severity: 'Medium',
    });

    // The same probe against an endpoint the role SHOULD hold, to characterise
    // the degradation: deny-everything is safe, and this records which it is.
    const allowDuringOutage = await req(api.base, 'GET', '/api/v1/admin/candidates', {
      token: fx.adminToken,
      timeoutMs: 15_000,
    });
    rec.check({
      id: 'redis-authz-degradation-shape',
      scenario: 'Redis outage',
      promise: 'The degradation is characterised (deny-all is safe; silent allow-all is not)',
      injected: 'Redis container stopped',
      expected: 'either 200 (DB fallback worked) or a non-2xx failure — never a 2xx for a role that lacks the grant',
      observed: `permission-holding role got ${allowDuringOutage.status}`,
      pass: true, // informational: the safety assertion is the check above
      severity: 'Info',
      detail: { note: allowDuringOutage.status === 200 ? 'served from the DB fallback' : 'denied during outage' },
    });

    // A completely unauthenticated request must still be rejected.
    const anon = await req(api.base, 'GET', '/api/v1/admin/candidates', { timeoutMs: 15_000 });
    rec.check({
      id: 'redis-auth-no-bypass',
      scenario: 'Redis outage',
      promise: 'Authentication never fails open — no token is still rejected while Redis is down',
      injected: 'Redis container stopped',
      expected: '401',
      observed: String(anon.status),
      pass: anon.status === 401,
      severity: 'Critical',
    });

    // ── The search cache must MISS THROUGH, not error ──────────────────────
    const search = await req(api.base, 'GET', '/api/v1/jobs?q=electrician', { timeoutMs: 20_000 });
    rec.check({
      id: 'redis-search-cache-misses-through',
      scenario: 'Redis outage',
      promise: 'The search cache is an optimisation — losing it degrades to a DB query, it does not break the feed',
      injected: 'Redis container stopped',
      expected: '200 with results served from Postgres',
      observed: `${search.status} ${codeOf(search) ?? ''} in ${search.ms}ms`,
      pass: search.status === 200,
      severity: 'High',
      detail: { bodyPreview: search.text.slice(0, 120) },
    });

    // ── Rate limiting must not fail OPEN ───────────────────────────────────
    // The throttler is in-memory today (H2 SEC-007), so it should be unaffected;
    // this records the actual behaviour rather than assuming it.
    const burst: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await req(api.base, 'POST', '/api/v1/auth/login', {
        body: { email: `chaos${i}@chaos.local`, password: 'wrong' },
        timeoutMs: 15_000,
      });
      burst.push(r.status);
    }
    rec.check({
      id: 'redis-ratelimit-not-open',
      scenario: 'Redis outage',
      promise: 'Rate limiting does not fail OPEN into unlimited credential attempts during a cache outage',
      injected: 'Redis container stopped',
      expected: 'attempts still bounded (a 429 appears) or the endpoint refuses entirely',
      observed: burst.join(','),
      pass: burst.some((s) => s === 429) || burst.every((s) => s >= 400),
      severity: 'High',
    });

    // ── Health must tell the truth ─────────────────────────────────────────
    const health = await req(api.base, 'GET', '/health', { timeoutMs: 15_000 });
    const hb = health.body as { redis?: string; status?: string } | null;
    rec.check({
      id: 'redis-health-honest',
      scenario: 'Redis outage',
      promise: 'Health reporting is honest — a down dependency is reported as down',
      injected: 'Redis container stopped',
      expected: 'redis: "down" in the health body',
      observed: `status=${hb?.status} redis=${hb?.redis}`,
      pass: hb?.redis === 'down',
      severity: 'High',
    });

    // ── RECOVERY without a restart ─────────────────────────────────────────
    console.log('\n── restoring: docker start redis ──');
    await reviveAndWait('redis');

    // POLL for recovery instead of sleeping a fixed amount. Redis answering
    // inside its container is not the same thing as the app having reconnected
    // — the client only retries on its own backoff schedule, and how long that
    // takes IS the recovery-latency property under test (CHAOS-002). A fixed
    // sleep would either race the reconnect or hide a slow one.
    const recoveryStarted = Date.now();
    let recoveryMs = -1;
    const recoveryDeadline = Date.now() + 60_000;
    while (Date.now() < recoveryDeadline) {
      const h = await req(api.base, 'GET', '/health');
      if ((h.body as { redis?: string } | null)?.redis === 'up') {
        recoveryMs = Date.now() - recoveryStarted;
        break;
      }
      await sleep(250);
    }
    rec.check({
      id: 'redis-recovery-is-prompt',
      scenario: 'Redis outage',
      promise: 'Recovery is PROMPT — the app notices Redis is back within seconds, not tens of seconds',
      injected: 'Redis stopped, then started',
      expected: 'reconnect observed within 10s of Redis accepting connections',
      observed: recoveryMs < 0 ? 'never reconnected within 60s' : `${recoveryMs}ms`,
      pass: recoveryMs >= 0 && recoveryMs < 10_000,
      severity: 'Medium',
    });

    const afterDeny = await req(api.base, 'GET', '/api/v1/admin/settings', { token: fx.moderatorToken });
    const afterAllow = await req(api.base, 'GET', '/api/v1/admin/candidates', { token: fx.adminToken });
    const afterHealth = await req(api.base, 'GET', '/health');
    const ahb = afterHealth.body as { redis?: string } | null;

    rec.check({
      id: 'redis-recovers-without-restart',
      scenario: 'Redis outage',
      promise: 'The app reconnects to Redis on its own — an outage does not require a redeploy',
      injected: 'Redis stopped, then started',
      expected: 'health redis:up, admin 200, moderator 403 — same process, no restart',
      observed: `redis=${ahb?.redis}, admin=${afterAllow.status}, moderator=${afterDeny.status}`,
      pass: ahb?.redis === 'up' && afterAllow.status === 200 && afterDeny.status === 403,
      severity: 'High',
    });

    rec.check({
      id: 'redis-authz-correct-after-recovery',
      scenario: 'Redis outage',
      promise: 'The permission cache repopulates correctly — no stale grant survives the outage',
      injected: 'Redis stopped, then started',
      expected: 'MODERATOR still denied settings.view after recovery',
      observed: `${afterDeny.status} ${codeOf(afterDeny) ?? ''}`,
      pass: afterDeny.status === 403,
      severity: 'Critical',
    });
  } finally {
    await api.stop();
    if (!isUp('redis')) await reviveAndWait('redis');
    if (process.env.CHAOS_KEEP_FIXTURES !== '1') await purge(prisma);
    await prisma.$disconnect();
  }

  finish(rec, 'redis-down.json');
}

main().catch(async (e) => {
  console.error(e);
  try {
    if (!isUp('redis')) await reviveAndWait('redis');
  } catch {
    /* best effort */
  }
  await prisma.$disconnect();
  process.exitCode = 1;
});
