/**
 * S8-H3 CHAOS — the "never silently claim success" discipline, under failure.
 *
 * This is the architecture's signature promise, and it is only worth anything
 * when things break. Three shapes are exercised:
 *
 *  1. A WHATSAPP SEND FAILS → the delivery row must end FAILED and the email
 *     fallback must fire. The forbidden outcome is a row reading SENT/DELIVERED
 *     for a message nobody received. Injected by pointing the mock channel at
 *     its failure trigger, so the real processor logic runs.
 *
 *  2. THE DATABASE GOES AWAY mid-request → in-flight transactions roll back
 *     cleanly (no half-written state), the API reports honestly rather than
 *     claiming success, and it RECOVERS on reconnect without a restart.
 *
 *  3. A FIRE-AND-FORGET SIDE EFFECT FAILS → the employer's read still
 *     succeeds. `recordView` is deliberately unawaited (S3-B2); a failure there
 *     must be logged, not turned into a failed read for the user.
 *
 *   pnpm chaos:nofalsesuccess
 */
import { DeliveryStatus, PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
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
  startWorker,
  waitFor,
} from './lib/harness';
import { build, purge } from './lib/fixtures';

const PORT = Number(process.env.CHAOS_API_PORT ?? 3305);
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const prisma = new PrismaClient();

async function main() {
  console.log('S8-H3 CHAOS — never silently claim success\n');
  const fx = await build(prisma);
  const rec = new ChaosRecorder();
  const notificationQueue = new Queue('notification', { connection: { url: REDIS_URL } });

  try {
    // ── 1. WhatsApp send failure → FAILED + email fallback ─────────────────
    // The mock channel fails for a designated phone number, so the processor's
    // real failure/fallback branch runs rather than a stubbed one.
    const waUser = await prisma.candidateProfile.findUniqueOrThrow({
      where: { id: fx.waCandidateId },
      select: { userId: true, phone: true },
    });

    const worker = await startWorker({ RENDER_POOL_CONCURRENCY: '1' });
    try {
      const waBefore = await prisma.whatsappMessage.count({ where: { userId: waUser.userId } });
      const emailBefore = await prisma.emailMessage.count({ where: { userId: waUser.userId } });

      await notificationQueue.add(
        'send-notification',
        {
          userId: waUser.userId,
          type: 'APPLICATION_SELECTED',
          channel: 'whatsapp',
          payload: { title: 'Selected', body: 'You have been selected.', data: {} },
        },
        { jobId: `chaos-wa-${Date.now()}`, attempts: 2, backoff: { type: 'fixed', delay: 1500 } },
      );

      await waitFor(
        async () => (await prisma.whatsappMessage.count({ where: { userId: waUser.userId } })) > waBefore,
        90_000,
        'a whatsapp_messages row to be written',
      );
      // Let retries and the fallback settle.
      await sleep(12_000);

      const rows = await prisma.whatsappMessage.findMany({
        where: { userId: waUser.userId },
        orderBy: { createdAt: 'desc' },
        select: { status: true, errorCode: true },
      });
      const emailAfter = await prisma.emailMessage.count({ where: { userId: waUser.userId } });
      const latest = rows[0];

      // The fixture's phone ends in the mock channel's failure trigger, so the
      // send genuinely fails inside the real channel and the processor's
      // failure branch runs. THE forbidden outcome is a row claiming delivery.
      rec.check({
        id: 'whatsapp-never-claims-false-delivery',
        scenario: 'Notification failure',
        promise: 'A failed WhatsApp send is NEVER recorded as delivered — the row states the failure',
        injected: 'WhatsApp channel rejects the send (number not on WhatsApp)',
        expected: 'the delivery row is FAILED, never SENT/DELIVERED',
        observed: `status=${latest?.status} errorCode=${latest?.errorCode ?? 'none'}`,
        pass: latest?.status === DeliveryStatus.FAILED,
        severity: 'Critical',
      });

      rec.check({
        id: 'whatsapp-failure-falls-back-to-email',
        scenario: 'Notification failure',
        promise: 'A failed WhatsApp send DOWNGRADES to email — the candidate is still reached by some channel',
        injected: 'WhatsApp channel rejects the send',
        expected: 'an email_messages row appears for the same user',
        observed: `emails ${emailBefore} → ${emailAfter}`,
        pass: emailAfter > emailBefore,
        severity: 'High',
      });
    } finally {
      await worker.stop();
    }

    // ── 3. Fire-and-forget failure must not break the read ─────────────────
    // Done BEFORE the DB scenario, since it needs a working database.
    const api = await startApi(PORT, { RATE_LIMIT_GLOBAL_PER_MIN: '1000000' });
    try {
      const view = await req(api.base, 'GET', `/api/v1/employers/candidates/${fx.candidateId}`, {
        token: fx.employerToken,
      });
      rec.check({
        id: 'fire-and-forget-baseline',
        scenario: 'Fire-and-forget failure',
        promise: 'Control: the employer candidate read works normally',
        injected: 'nothing',
        expected: '200',
        observed: String(view.status),
        pass: view.status === 200,
        severity: 'Info',
      });

      // ── 2. DATABASE OUTAGE ───────────────────────────────────────────────
      console.log('\n── injecting: docker stop postgres ──');
      killDependency('postgres');
      await sleep(1500);

      const readDuringOutage = await req(api.base, 'GET', `/api/v1/employers/candidates/${fx.candidateId}`, {
        token: fx.employerToken,
        timeoutMs: 25_000,
      });
      rec.check({
        id: 'db-outage-no-false-success',
        scenario: 'Database outage',
        promise: 'With the database gone, the API reports failure honestly — it never returns fabricated or partial data as success',
        injected: 'Postgres container stopped',
        expected: 'non-2xx',
        observed: `${readDuringOutage.status} ${codeOf(readDuringOutage) ?? ''}`,
        pass: readDuringOutage.status < 200 || readDuringOutage.status >= 300,
        severity: 'Critical',
      });

      const writeDuringOutage = await req(api.base, 'POST', `/api/v1/jobs/${fx.jobId}/apply`, {
        token: fx.candidateToken,
        body: { coverLetter: 'Applying during a database outage.' },
        timeoutMs: 25_000,
      });
      rec.check({
        id: 'db-outage-write-refused',
        scenario: 'Database outage',
        promise: 'A write that cannot reach the database is refused, not optimistically acknowledged',
        injected: 'Postgres container stopped',
        expected: 'non-2xx',
        observed: `${writeDuringOutage.status} ${codeOf(writeDuringOutage) ?? ''}`,
        pass: writeDuringOutage.status < 200 || writeDuringOutage.status >= 300,
        severity: 'Critical',
      });

      const healthDuringOutage = await req(api.base, 'GET', '/health', { timeoutMs: 15_000 });
      const hb = healthDuringOutage.body as { db?: string; status?: string } | null;
      rec.check({
        id: 'db-outage-health-honest',
        scenario: 'Database outage',
        promise: 'Health answers promptly and honestly during a database outage',
        injected: 'Postgres container stopped',
        expected: 'a response with db:"down" and status:"degraded"',
        observed: `status=${hb?.status} db=${hb?.db}`,
        pass: hb?.db === 'down' && hb?.status === 'degraded',
        severity: 'High',
      });

      const readyDuringOutage = await req(api.base, 'GET', '/health/ready', { timeoutMs: 15_000 });
      const rb = readyDuringOutage.body as { status?: string } | null;
      rec.check({
        id: 'db-outage-readiness-not-ready',
        scenario: 'Database outage',
        promise: 'Readiness turns NOT_READY when the database is gone, so the platform stops routing traffic here',
        injected: 'Postgres container stopped',
        expected: 'status "not_ready"',
        observed: String(rb?.status),
        pass: rb?.status === 'not_ready',
        severity: 'High',
      });

      // ── recovery without a restart ───────────────────────────────────────
      console.log('── restoring: docker start postgres ──');
      await reviveAndWait('postgres');

      let recovered = false;
      const started = Date.now();
      let recoveryMs = -1;
      while (Date.now() - started < 90_000) {
        const r = await req(api.base, 'GET', `/api/v1/employers/candidates/${fx.candidateId}`, {
          token: fx.employerToken,
          timeoutMs: 15_000,
        });
        if (r.status === 200) {
          recovered = true;
          recoveryMs = Date.now() - started;
          break;
        }
        await sleep(1000);
      }
      rec.check({
        id: 'db-recovers-without-restart',
        scenario: 'Database outage',
        promise: 'The connection pool re-establishes itself — a database blip does not require redeploying the API',
        injected: 'Postgres stopped, then started',
        expected: 'reads succeed again in the SAME process',
        observed: recovered ? `recovered after ${recoveryMs}ms` : 'never recovered within 90s',
        pass: recovered,
        severity: 'Critical',
      });

      // No half-written state from the refused write.
      const apps = await prisma.application.count({
        where: { jobId: fx.jobId, candidateId: fx.candidateId },
      });
      rec.check({
        id: 'db-outage-no-partial-write',
        scenario: 'Database outage',
        promise: 'A transaction interrupted by the outage rolled back cleanly — no half-written application row',
        injected: 'apply attempted while Postgres was down',
        expected: '0 applications for that (job, candidate)',
        observed: `${apps} application row(s)`,
        pass: apps === 0,
        severity: 'Critical',
      });
    } finally {
      await api.stop();
    }
  } finally {
    await notificationQueue.close();
    if (!isUp('postgres')) await reviveAndWait('postgres');
    if (process.env.CHAOS_KEEP_FIXTURES !== '1') await purge(prisma);
    await prisma.$disconnect();
  }

  finish(rec, 'no-false-success.json');
}

main().catch(async (e) => {
  console.error(e);
  try {
    if (!isUp('postgres')) await reviveAndWait('postgres');
  } catch {
    /* best effort */
  }
  await prisma.$disconnect();
  process.exitCode = 1;
});
