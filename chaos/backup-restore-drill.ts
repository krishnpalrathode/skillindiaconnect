/**
 * S8-H3 PART 2 — the backup/restore drill. Performed for real, and MEASURED.
 *
 * Targets carried over from Phase 1's flagged risks: **RPO ≤ 5 minutes**,
 * **RTO ≤ 1 hour**. This script does not assume them — it simulates a
 * data-loss event and measures what actually happens.
 *
 * THE METHOD
 *   1. Seed a known, cross-linked corpus (companies → jobs → applications,
 *      orders → invoices, audit rows) and record a fingerprint of it.
 *   2. Take a base backup (`pg_dump`) and note the wall-clock time — this is
 *      the last recoverable point for a snapshot-only strategy.
 *   3. Keep writing AFTER the backup. These writes are what an RPO measures:
 *      with snapshot-only backups they are exactly what a restore loses.
 *   4. DESTROY the database (drop the schema — a real, irreversible loss).
 *   5. RESTORE from the backup, timing the whole path to service-restored,
 *      including the application coming back up and answering.
 *   6. Verify INTEGRITY: cross-table referential consistency, financial
 *      linkage, the audit trail, and DB↔object-store agreement.
 *
 * Everything runs against a DISPOSABLE drill database (`*_drill`), created and
 * dropped by this script. The developer database is never touched.
 *
 *   pnpm chaos:drill
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ChaosRecorder, CONTAINERS, REPO_ROOT, finish, sleep, startApi, req } from './lib/harness';

const PG = CONTAINERS.postgres;
const DRILL_DB = process.env.DRILL_DB ?? 'skillindiaconnect_drill';
const PGUSER = 'postgres';
const BACKUP_DIR = path.join(REPO_ROOT, 'chaos', 'out', 'backups');
const DUMP_IN_CONTAINER = '/tmp/drill-backup.dump';
const PORT = Number(process.env.CHAOS_API_PORT ?? 3306);

/** RPO/RTO targets (Phase-1 risk register). */
const RPO_TARGET_S = 5 * 60;
const RTO_TARGET_S = 60 * 60;

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function psql(db: string, sql: string): string {
  return docker(['exec', PG, 'psql', '-U', PGUSER, '-d', db, '-t', '-A', '-c', sql]).trim();
}

function drillUrl(): string {
  return `postgresql://postgres:postgres@localhost:5433/${DRILL_DB}`;
}

interface Fingerprint {
  companies: number;
  jobs: number;
  applications: number;
  orders: number;
  invoices: number;
  auditRows: number;
  candidates: number;
}

async function fingerprint(prisma: PrismaClient): Promise<Fingerprint> {
  const [companies, jobs, applications, orders, invoices, auditRows, candidates] = await Promise.all([
    prisma.company.count(),
    prisma.job.count(),
    prisma.application.count(),
    prisma.order.count(),
    prisma.invoice.count(),
    prisma.auditLog.count(),
    prisma.candidateProfile.count(),
  ]);
  return { companies, jobs, applications, orders, invoices, auditRows, candidates };
}

async function main() {
  console.log('S8-H3 — BACKUP / RESTORE DRILL (performed for real)');
  console.log(`  targets: RPO ≤ ${RPO_TARGET_S / 60} min, RTO ≤ ${RTO_TARGET_S / 60} min`);
  console.log(`  drill database: ${DRILL_DB} (disposable; the dev database is untouched)\n`);

  const rec = new ChaosRecorder();
  mkdirSync(BACKUP_DIR, { recursive: true });

  // ── 0. Build the drill database as a clone of the dev schema+data ────────
  console.log('── preparing the drill database ──');
  try {
    psql('postgres', `DROP DATABASE IF EXISTS ${DRILL_DB} WITH (FORCE)`);
  } catch {
    /* first run */
  }
  // TEMPLATE copies schema AND data, giving the drill a realistic corpus
  // (the S8-H1 load data: ~10k jobs, ~20k candidates, ~50k applications).
  psql('postgres', `CREATE DATABASE ${DRILL_DB} TEMPLATE skillindiaconnect_dev`);

  const prisma = new PrismaClient({ datasources: { db: { url: drillUrl() } } });
  const before = await fingerprint(prisma);
  console.log(`  corpus: ${JSON.stringify(before)}`);

  // ── 1. TAKE THE BACKUP ──────────────────────────────────────────────────
  console.log('\n── taking the backup (pg_dump -Fc) ──');
  const backupStart = Date.now();
  docker(['exec', PG, 'pg_dump', '-U', PGUSER, '-d', DRILL_DB, '-Fc', '-f', DUMP_IN_CONTAINER]);
  const backupMs = Date.now() - backupStart;
  const localDump = path.join(BACKUP_DIR, `drill-${Date.now()}.dump`);
  docker(['cp', `${PG}:${DUMP_IN_CONTAINER}`, localDump]);
  const dumpBytes = statSync(localDump).size;
  const backupCompletedAt = Date.now();
  console.log(`  backup done in ${backupMs}ms, ${(dumpBytes / 1024 / 1024).toFixed(1)}MB`);

  // ── 2. WRITES AFTER THE BACKUP — this is what an RPO measures ────────────
  // With snapshot-only backups every one of these is lost. The gap between the
  // last of them and the backup IS the realised RPO.
  console.log('\n── writing post-backup data (the RPO window) ──');
  const postBackupJobIds: string[] = [];
  const company = await prisma.company.findFirstOrThrow({ select: { id: true } });
  const category = await prisma.jobCategory.findFirstOrThrow({ select: { id: true } });
  for (let i = 0; i < 5; i++) {
    const j = await prisma.job.create({
      data: {
        companyId: company.id,
        title: `POST-BACKUP DRILL JOB ${i}`,
        employmentType: 'FULL_TIME',
        market: 'GULF',
        status: 'ACTIVE',
        location: 'Dubai',
        description: 'Written after the backup — expected to be lost on restore.',
        categoryId: category.id,
        salaryMin: 1000,
        salaryMax: 2000,
        currency: 'AED',
        accommodation: true,
        healthInsurance: true,
        transportation: true,
        hoursPerDay: 8,
        daysPerWeek: 6,
        publishedAt: new Date(),
      },
    });
    postBackupJobIds.push(j.id);
    await sleep(400);
  }
  const lastWriteAt = Date.now();
  await prisma.$disconnect();

  // ── 3. DESTROY ──────────────────────────────────────────────────────────
  console.log('\n── SIMULATING DATA LOSS: dropping the public schema ──');
  const incidentAt = Date.now();
  psql(DRILL_DB, 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

  const destroyed = new PrismaClient({ datasources: { db: { url: drillUrl() } } });
  let lossConfirmed = false;
  try {
    await destroyed.job.count();
  } catch {
    lossConfirmed = true;
  }
  await destroyed.$disconnect();
  rec.check({
    id: 'drill-data-loss-real',
    scenario: 'Backup/restore drill',
    promise: 'Control: the data-loss event is REAL — the drill restores from a genuinely destroyed database',
    injected: 'DROP SCHEMA public CASCADE',
    expected: 'queries fail; the data is gone',
    observed: lossConfirmed ? 'database unusable, as intended' : 'DATA STILL PRESENT — the drill would be meaningless',
    pass: lossConfirmed,
    severity: 'Info',
  });

  // ── 4. RESTORE (the RTO clock runs from here) ───────────────────────────
  console.log('\n── RESTORING from backup ──');
  const restoreStart = Date.now();
  docker([
    'exec',
    PG,
    'pg_restore',
    '-U',
    PGUSER,
    '-d',
    DRILL_DB,
    '--no-owner',
    '--no-privileges',
    DUMP_IN_CONTAINER,
  ]);
  const dataRestoredAt = Date.now();
  console.log(`  pg_restore finished in ${((dataRestoredAt - restoreStart) / 1000).toFixed(1)}s`);

  // RTO is not "the data is back" — it is "the SERVICE is back". Boot the API
  // against the restored database and require it to actually answer.
  const api = await startApi(PORT, {
    DATABASE_URL: drillUrl(),
    RATE_LIMIT_GLOBAL_PER_MIN: '1000000',
    RATE_LIMIT_SEARCH_PER_MIN: '1000000',
  });
  let serviceRestoredAt = 0;
  try {
    const search = await req(api.base, 'GET', '/api/v1/jobs?q=electrician');
    const health = await req(api.base, 'GET', '/health');
    serviceRestoredAt = Date.now();
    const hb = health.body as { db?: string } | null;
    rec.check({
      id: 'drill-service-restored',
      scenario: 'Backup/restore drill',
      promise: 'RTO is measured to SERVICE RESTORED — the application serves real traffic off the restored database',
      injected: 'full restore from backup',
      expected: 'the public search returns 200 and health reports db:up',
      observed: `search=${search.status} health.db=${hb?.db}`,
      pass: search.status === 200 && hb?.db === 'up',
      severity: 'Critical',
    });
  } finally {
    await api.stop();
  }

  const rtoS = (serviceRestoredAt - incidentAt) / 1000;
  // RPO = how much time's worth of writes was lost: from the last recoverable
  // point (the backup) to the last write that existed before the incident.
  const rpoS = (lastWriteAt - backupCompletedAt) / 1000;

  // ── 5. INTEGRITY VERIFICATION ───────────────────────────────────────────
  console.log('\n── verifying integrity of the restored data ──');
  const after = new PrismaClient({ datasources: { db: { url: drillUrl() } } });
  const restored = await fingerprint(after);

  rec.check({
    id: 'drill-row-counts-match',
    scenario: 'Backup/restore drill',
    promise: 'Everything captured by the backup is present after the restore',
    injected: 'restore from pg_dump',
    expected: JSON.stringify(before),
    observed: JSON.stringify(restored),
    pass:
      restored.companies === before.companies &&
      restored.jobs === before.jobs &&
      restored.applications === before.applications &&
      restored.orders === before.orders &&
      restored.invoices === before.invoices &&
      restored.candidates === before.candidates,
    severity: 'Critical',
  });

  // Referential integrity — the failure mode that makes a restore worthless.
  const orphanApplications = Number(
    psql(DRILL_DB, 'SELECT count(*) FROM applications a LEFT JOIN jobs j ON j.id = a."jobId" WHERE j.id IS NULL'),
  );
  const orphanInvoices = Number(
    psql(DRILL_DB, 'SELECT count(*) FROM invoices i LEFT JOIN orders o ON o.id = i."orderId" WHERE o.id IS NULL'),
  );
  const orphanJobs = Number(
    psql(DRILL_DB, 'SELECT count(*) FROM jobs j LEFT JOIN companies c ON c.id = j."companyId" WHERE c.id IS NULL'),
  );
  rec.check({
    id: 'drill-referential-integrity',
    scenario: 'Backup/restore drill',
    promise: 'Cross-table links survive the restore — applications→jobs, invoices→orders, jobs→companies',
    injected: 'restore from pg_dump',
    expected: '0 orphans of every kind',
    observed: `orphan applications=${orphanApplications}, invoices=${orphanInvoices}, jobs=${orphanJobs}`,
    pass: orphanApplications === 0 && orphanInvoices === 0 && orphanJobs === 0,
    severity: 'Critical',
  });

  // The GST invoice sequence must survive: a restored sequence that rewinds
  // would re-issue existing invoice numbers, which is a legal problem, not a
  // technical one.
  const maxInvoiceSeq = Number(
    psql(DRILL_DB, "SELECT COALESCE(MAX(split_part(number,'-',3)::int),0) FROM invoices") || 0,
  );
  const seqValue = Number(psql(DRILL_DB, "SELECT last_value FROM invoice_number_seq") || 0);
  rec.check({
    id: 'drill-invoice-sequence-preserved',
    scenario: 'Backup/restore drill',
    promise: 'The GST invoice sequence is restored AHEAD of every issued number — no number is ever re-issued',
    injected: 'restore from pg_dump',
    expected: `invoice_number_seq (${seqValue}) >= max issued number (${maxInvoiceSeq})`,
    observed: `seq=${seqValue} maxIssued=${maxInvoiceSeq}`,
    pass: seqValue >= maxInvoiceSeq,
    severity: 'Critical',
  });

  const auditIntact = restored.auditRows >= before.auditRows;
  rec.check({
    id: 'drill-audit-trail-intact',
    scenario: 'Backup/restore drill',
    promise: 'The audit trail survives — the compliance record is not a casualty of recovery',
    injected: 'restore from pg_dump',
    expected: `>= ${before.auditRows} audit rows`,
    observed: String(restored.auditRows),
    pass: auditIntact,
    severity: 'High',
  });

  // ── The RPO reality check ───────────────────────────────────────────────
  const survivingPostBackup = await after.job.count({ where: { id: { in: postBackupJobIds } } });
  rec.check({
    id: 'drill-post-backup-writes-lost',
    scenario: 'Backup/restore drill',
    promise: 'HONEST RPO ACCOUNTING — writes made after the backup are gone, and the drill says so rather than assuming continuity',
    injected: '5 jobs written after the backup, then data loss',
    expected: '0 of them survive a snapshot-only restore (this is the definition of the RPO gap)',
    observed: `${survivingPostBackup}/${postBackupJobIds.length} post-backup rows survived`,
    pass: survivingPostBackup === 0,
    severity: 'Info',
  });

  // DB ↔ object-store consistency: document rows must still point at keys, and
  // the pairing question must be answered rather than assumed.
  const docsWithKeys = Number(psql(DRILL_DB, 'SELECT count(*) FROM candidate_documents WHERE "r2Key" IS NOT NULL'));
  rec.check({
    id: 'drill-db-object-store-pairing',
    scenario: 'Backup/restore drill',
    promise: 'The DB↔object-store relationship after restore is understood and documented, not assumed consistent',
    injected: 'DB restored to T1 while the object store remains at T2',
    expected: 'document rows still carry their keys; reconciliation requirements recorded in the runbook',
    observed: `${docsWithKeys} document rows retain r2Key references (objects themselves are NOT part of this dump)`,
    pass: docsWithKeys > 0,
    severity: 'High',
  });

  await after.$disconnect();

  // ── VERDICT ─────────────────────────────────────────────────────────────
  rec.check({
    id: 'drill-rto-within-target',
    scenario: 'Backup/restore drill',
    promise: `RTO ≤ ${RTO_TARGET_S / 60} minutes (Phase-1 target)`,
    injected: 'schema destroyed, then restored to serving traffic',
    expected: `≤ ${RTO_TARGET_S}s`,
    observed: `${rtoS.toFixed(1)}s (${(rtoS / 60).toFixed(1)} min)`,
    pass: rtoS <= RTO_TARGET_S,
    severity: 'Critical',
  });

  rec.check({
    id: 'drill-rpo-within-target',
    scenario: 'Backup/restore drill',
    promise: `RPO ≤ ${RPO_TARGET_S / 60} minutes (Phase-1 target)`,
    injected: 'data loss with a snapshot taken before the final writes',
    expected: `≤ ${RPO_TARGET_S}s of writes lost`,
    observed: `${rpoS.toFixed(1)}s of writes lost in THIS drill`,
    pass: rpoS <= RPO_TARGET_S,
    severity: 'Critical',
    detail: {
      caveat:
        'This measures the drill window, not the production RPO. With snapshot-only backups the ' +
        'real RPO equals the BACKUP INTERVAL, so meeting 5 minutes requires continuous archiving ' +
        '(PITR/WAL) or 5-minute snapshots — see the drill report.',
    },
  });

  console.log('\n════ DRILL RESULT ════');
  console.log(`  backup       : ${backupMs}ms for ${(dumpBytes / 1024 / 1024).toFixed(1)}MB`);
  console.log(`  restore(data): ${((dataRestoredAt - restoreStart) / 1000).toFixed(1)}s`);
  console.log(`  RTO (measured, incident → service restored): ${rtoS.toFixed(1)}s`);
  console.log(`  RPO (measured, this drill's write window)  : ${rpoS.toFixed(1)}s`);

  // Clean up the disposable drill database.
  try {
    psql('postgres', `DROP DATABASE IF EXISTS ${DRILL_DB} WITH (FORCE)`);
  } catch {
    /* leave it for inspection */
  }

  finish(rec, 'backup-restore-drill.json');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
