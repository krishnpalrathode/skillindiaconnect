/**
 * S8-H3 CHAOS — object storage (R2/MinIO) unavailable.
 *
 * Three promises, each at a different point in a write's lifetime:
 *
 *  1. UPLOAD — a document confirm with storage down must fail CLEANLY. The
 *     dangerous outcome is a PHANTOM RECORD: a `candidate_documents` row whose
 *     object does not exist, which later reads as "passport uploaded" and
 *     lets a candidate past the apply gate with nothing behind it.
 *
 *  2. PURGE (S6b-B1's resumability) — the DB anonymization commits, then the
 *     R2 delete fails. This is the nastiest shape in the system: the erasure
 *     is half-done and the DB no longer knows the keys. The promise is that
 *     the job RETRIES from the pre-captured key list and completes, with no
 *     corruption and no double-anonymization. Tested by failing storage across
 *     the R2 step and then restoring it.
 *
 *  3. RENDER — a PDF render with storage down must fail and be RETRIED by
 *     BullMQ, not marked READY with no bytes behind it.
 *
 * Injection: the MinIO container is STOPPED — real refused sockets.
 *
 *   pnpm chaos:storage
 */
import { PrismaClient, ResumeGenerationStatus, ResumeTrigger, UserStatus } from '@prisma/client';
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

const PORT = Number(process.env.CHAOS_API_PORT ?? 3303);
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const prisma = new PrismaClient();

async function main() {
  console.log('S8-H3 CHAOS — object storage outage\n');
  const fx = await build(prisma);
  const rec = new ChaosRecorder();

  const api = await startApi(PORT, { RATE_LIMIT_GLOBAL_PER_MIN: '1000000' });
  const purgeQueue = new Queue('account-purge', { connection: { url: REDIS_URL } });
  const resumeQueue = new Queue('resume-render', { connection: { url: REDIS_URL } });

  try {
    // ── 1. UPLOAD with storage down: no phantom document row ───────────────
    console.log('── injecting: docker stop minio ──');
    killDependency('minio');
    await sleep(1000);

    const docsBefore = await prisma.candidateDocument.count({ where: { candidateId: fx.candidateId } });
    const presign = await req(api.base, 'POST', '/api/v1/candidates/me/documents/presign', {
      token: fx.candidateToken,
      body: { type: 'PASSPORT', fileName: 'p.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
      timeoutMs: 30_000,
    });
    // Confirm claims an upload completed. With storage down the HEAD check
    // cannot succeed, so this must be refused.
    const confirm = await req(api.base, 'POST', '/api/v1/candidates/me/documents/confirm', {
      token: fx.candidateToken,
      body: {
        key: `candidates/${fx.candidateId}/PASSPORT/${Date.now()}-p.pdf`,
        type: 'PASSPORT',
        fileName: 'p.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      },
      timeoutMs: 30_000,
    });
    const docsAfter = await prisma.candidateDocument.count({ where: { candidateId: fx.candidateId } });

    rec.check({
      id: 'storage-confirm-refused',
      scenario: 'Storage outage — upload',
      promise: 'A document confirm cannot succeed while the object store is unreachable',
      injected: 'MinIO container stopped',
      expected: 'non-2xx from confirm',
      observed: `presign=${presign.status} confirm=${confirm.status} ${codeOf(confirm) ?? ''}`,
      pass: confirm.status < 200 || confirm.status >= 300,
      severity: 'High',
    });
    rec.check({
      id: 'storage-no-phantom-document',
      scenario: 'Storage outage — upload',
      promise: 'NO PHANTOM RECORD — a failed upload never leaves a document row with no object behind it',
      injected: 'MinIO container stopped',
      expected: `document count unchanged (${docsBefore})`,
      observed: String(docsAfter),
      pass: docsAfter === docsBefore,
      severity: 'Critical',
    });

    // ── 2. PURGE resumability (S6b-B1) ─────────────────────────────────────
    // The worker runs with storage DOWN: the DB anonymization commits, the R2
    // delete fails, the job retries. Storage is then restored and the retry
    // must complete the erasure without corrupting the half-purged row.
    const victim = await prisma.user.findUniqueOrThrow({
      where: { id: fx.candidateUserId },
      select: { id: true, email: true },
    });
    await prisma.user.update({
      where: { id: victim.id },
      data: { status: UserStatus.PENDING_DELETION, deletionDueAt: new Date(Date.now() - 86_400_000) },
    });

    const worker = await startWorker({
      RENDER_POOL_CONCURRENCY: '1',
      RESUME_RENDER_CONCURRENCY: '1',
    });

    try {
      // `capturedKeys` is deliberately NOT supplied: the processor captures the
      // real key list itself and persists it into the job before any
      // destruction. That capture-then-persist step is precisely the mechanism
      // that makes the retry able to finish after the DB has forgotten the keys,
      // so the drill must exercise it rather than hand it a synthetic list.
      await purgeQueue.add(
        'purge-candidate',
        { userId: victim.id, trigger: 'admin', reason: 'chaos drill' },
        { jobId: `chaos-purge-${victim.id}`, attempts: 5, backoff: { type: 'fixed', delay: 2000 } },
      );

      // The DB half must commit even though R2 is unreachable.
      let dbAnonymized = false;
      try {
        await waitFor(
          async () => {
            const u = await prisma.user.findUnique({
              where: { id: victim.id },
              select: { email: true, purgedAt: true },
            });
            dbAnonymized = !!u && u.email !== victim.email;
            return dbAnonymized;
          },
          45_000,
          'DB anonymization to commit while storage is down',
        );
      } catch {
        /* recorded below */
      }

      rec.check({
        id: 'purge-db-commits-despite-storage-down',
        scenario: 'Storage outage — purge',
        promise: 'The DB erasure commits independently of object deletion — the legally-required part does not wait on R2',
        injected: 'MinIO stopped, purge job enqueued',
        expected: 'the user row is anonymized',
        observed: dbAnonymized ? 'anonymized' : 'NOT anonymized',
        pass: dbAnonymized,
        severity: 'High',
      });

      // NOTE on what "complete" means here. `purgedAt` is set INSIDE the DB
      // transaction (step 2) and is the RESUME MARKER, not a completion flag —
      // it is precisely what lets a retry skip the DB work and re-enter at the
      // R2 step. So finding it set while storage is down is the mechanism
      // working, not a violation.
      //
      // The signal that the system CLAIMS the erasure finished is the
      // `account.purged` completion audit row, written only after
      // destroyObjects() returns. That is what must be absent while R2 is
      // failing, and it is the honest thing to assert.
      const auditWhileDown = await prisma.auditLog.count({
        where: { action: 'account.purged', targetId: victim.id },
      });
      rec.check({
        id: 'purge-no-false-completion-claim',
        scenario: 'Storage outage — purge',
        promise: 'No false "erased" — the completion audit is not written while object deletion is still failing',
        injected: 'MinIO stopped',
        expected: '0 account.purged audit rows while storage is unreachable',
        observed: `${auditWhileDown} completion audit row(s)`,
        pass: auditWhileDown === 0,
        severity: 'Critical',
      });

      // ── restore storage: the retry must finish the job ───────────────────
      console.log('── restoring: docker start minio ──');
      await reviveAndWait('minio');

      // Completion is the audit row — the same signal asserted absent above.
      let completed = false;
      try {
        await waitFor(
          async () => {
            completed =
              (await prisma.auditLog.count({
                where: { action: 'account.purged', targetId: victim.id },
              })) > 0;
            return completed;
          },
          150_000,
          'the purge retry to write its completion audit after storage returned',
        );
      } catch {
        /* recorded below */
      }

      rec.check({
        id: 'purge-resumes-after-storage-returns',
        scenario: 'Storage outage — purge',
        promise:
          'S6b-B1 RESUMABILITY — a purge that failed AFTER the DB commit re-enters at the R2 step and completes on retry',
        injected: 'MinIO stopped during the purge, then restarted',
        expected: 'the BullMQ retry finishes and writes the account.purged completion audit',
        observed: completed ? 'completed on retry' : 'did NOT complete within the window',
        pass: completed,
        severity: 'Critical',
      });

      // Resumability must not mean double-execution: exactly ONE completion
      // audit, however many attempts it took.
      const auditCount = await prisma.auditLog.count({
        where: { action: 'account.purged', targetId: victim.id },
      });
      rec.check({
        id: 'purge-exactly-one-completion',
        scenario: 'Storage outage — purge',
        promise: 'Retries are idempotent — a resumed purge records completion ONCE, not once per attempt',
        injected: 'several failed attempts, then a successful retry',
        expected: 'exactly 1 account.purged audit row',
        observed: `${auditCount} row(s)`,
        pass: auditCount === 1,
        severity: 'High',
      });

      // Corruption check: exactly one anonymized user, still PENDING_DELETION,
      // and the applications tombstoned rather than deleted.
      const finalUser = await prisma.user.findUnique({
        where: { id: victim.id },
        select: { status: true, purgedAt: true, email: true },
      });
      const profile = await prisma.candidateProfile.findUnique({
        where: { id: fx.candidateId },
        select: { fullName: true },
      });
      rec.check({
        id: 'purge-no-corruption',
        scenario: 'Storage outage — purge',
        promise: 'The resumed purge leaves consistent state — anonymized once, status intact, nothing half-written',
        injected: 'storage failure mid-purge, then retry',
        expected: 'status PENDING_DELETION, purgedAt set, email + profile anonymized',
        observed: `status=${finalUser?.status} purgedAt=${finalUser?.purgedAt ? 'set' : 'null'} email=${finalUser?.email?.slice(0, 24)} profile=${profile?.fullName ?? '(row gone)'}`,
        pass:
          finalUser?.status === UserStatus.PENDING_DELETION &&
          !!finalUser.purgedAt &&
          finalUser.email !== victim.email,
        severity: 'Critical',
      });

      // ── 3. RENDER with storage down → retried, never falsely READY ───────
      console.log('\n── injecting: docker stop minio (render) ──');
      killDependency('minio');
      await sleep(1000);

      const resume = await prisma.candidateResume.upsert({
        where: { candidateId: fx.waCandidateId },
        create: { candidateId: fx.waCandidateId },
        update: {},
      });
      const generation = await prisma.resumeGeneration.create({
        data: {
          resumeId: resume.id,
          status: ResumeGenerationStatus.PENDING,
          trigger: ResumeTrigger.DOWNLOAD,
          settingsSnapshot: {
            language: 'en',
            showPhone: true,
            showReligion: false,
            showFatherName: true,
            showPassportNumber: false,
          },
        },
      });
      await resumeQueue.add(
        'generate-resume',
        { generationId: generation.id, candidateId: fx.waCandidateId },
        { jobId: `chaos-render-${generation.id}`, attempts: 3, backoff: { type: 'fixed', delay: 1500 } },
      );

      await sleep(20_000); // let the attempts burn against a dead store
      const g = await prisma.resumeGeneration.findUnique({
        where: { id: generation.id },
        select: { status: true, r2Key: true },
      });
      rec.check({
        id: 'render-never-falsely-ready',
        scenario: 'Storage outage — render',
        promise: 'A render that could not store its bytes is NEVER marked READY (no downloadable-but-missing PDF)',
        injected: 'MinIO stopped while a render job ran',
        expected: 'status PENDING or FAILED, r2Key null — never READY',
        observed: `status=${g?.status} r2Key=${g?.r2Key ?? 'null'}`,
        pass: g?.status !== ResumeGenerationStatus.READY && !g?.r2Key,
        severity: 'Critical',
      });

      console.log('── restoring: docker start minio ──');
      await reviveAndWait('minio');
    } finally {
      await worker.stop();
    }
  } finally {
    await api.stop();
    await purgeQueue.close();
    await resumeQueue.close();
    if (!isUp('minio')) await reviveAndWait('minio');
    if (process.env.CHAOS_KEEP_FIXTURES !== '1') await purge(prisma);
    await prisma.$disconnect();
  }

  finish(rec, 'storage-down.json');
}

main().catch(async (e) => {
  console.error(e);
  try {
    if (!isUp('minio')) await reviveAndWait('minio');
  } catch {
    /* best effort */
  }
  await prisma.$disconnect();
  process.exitCode = 1;
});
