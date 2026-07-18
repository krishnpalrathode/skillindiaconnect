/**
 * The subscription expiry ladder on real Postgres (Testcontainers), with
 * time-manipulated fixtures:
 *
 *   ACTIVE →(T-7 reminder)→(T-1 reminder)→ GRACE(+notify) → EXPIRED(+pause rule)
 *
 * Real Prisma, real AuditService (rows asserted from audit_logs), real
 * NotificationService against the container DB (the reminder LEDGER lives in
 * the notifications table — stubbing it would un-test the dedupe) with the
 * BullMQ boundary stubbed. Real JobLifecycleService so pauses are the audited,
 * event-emitting transition.
 *
 * Skips gracefully when Docker is unavailable (mirrors webhooks.matrix.spec).
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job as BullJob, Queue } from 'bullmq';
import {
  CompanyStatus,
  CompanyType,
  Currency,
  EmploymentType,
  JobMarket,
  JobStatus,
  PlanPeriod,
  PrismaClient,
  SubscriptionStatus,
  UserRole,
} from '@prisma/client';
import { execSync } from 'child_process';
import * as path from 'path';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import { NotificationService } from '../notifications/notification.service';
import { EmployerService } from '../employer/employer.service';
import { JobLifecycleService } from '../jobs/job-lifecycle.service';
import { JOB_NAMES } from '../queue/queue.constants';
import { SubscriptionLifecycleProcessor } from './subscription-lifecycle.processor';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');
const DAY_MS = 24 * 60 * 60 * 1000;
const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);
const daysFromNow = (d: number) => new Date(Date.now() + d * DAY_MS);

let pg: StartedTestContainer;
let prisma: PrismaClient;
let processor: SubscriptionLifecycleProcessor;
let queueAdd: jest.Mock;
let dockerUnavailable = false;

let proPlanId: string;
let categoryId: string;
let seq = 0;

beforeAll(async () => {
  try {
    pg = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_USER: 'sic', POSTGRES_PASSWORD: 'sic', POSTGRES_DB: 'sic_lifecycle' })
      .withExposedPorts(5432)
      .start();
    const url = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_lifecycle`;
    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();

    proPlanId = (
      await prisma.plan.create({
        data: { code: 'PRO_MONTHLY', name: 'Pro Monthly', priceSubunits: 299_900, period: PlanPeriod.MONTHLY, maxActiveJobs: null, features: [] },
      })
    ).id;
    // A FREE plan row exists in prod seeds — present here to prove the sweep ignores it.
    await prisma.plan.create({
      data: { code: 'FREE', name: 'Free', priceSubunits: 0, period: PlanPeriod.FOREVER, maxActiveJobs: 1, features: [] },
    });
    categoryId = (
      await prisma.jobCategory.create({ data: { slug: 'lc-general', nameEn: 'LC General' } })
    ).id;

    const prismaSvc = prisma as unknown as PrismaService;
    const audit = new AuditService(prismaSvc);
    queueAdd = jest.fn().mockResolvedValue(undefined);
    const notifications = new NotificationService(prismaSvc, { add: queueAdd } as unknown as Queue);
    const employer = new EmployerService(prismaSvc, null as never); // StorageService unused here
    const jobLifecycle = new JobLifecycleService(prismaSvc, audit, new EventEmitter2());

    processor = new SubscriptionLifecycleProcessor(
      prismaSvc,
      notifications,
      audit,
      employer,
      jobLifecycle,
    );
  } catch {
    dockerUnavailable = true;
    // eslint-disable-next-line no-console
    console.warn('Docker unavailable — skipping subscription-lifecycle tests.');
  }
});

afterAll(async () => {
  if (dockerUnavailable) return;
  await prisma.$disconnect();
  await pg.stop();
});

const gatedIt = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (dockerUnavailable) return;
    await fn();
  });

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function mkCompany(): Promise<{ companyId: string; userId: string }> {
  const n = ++seq;
  const user = await prisma.user.create({
    data: { email: `lc-emp-${n}@example.com`, role: UserRole.EMPLOYER },
  });
  const company = await prisma.company.create({
    data: {
      name: `Lifecycle Co ${n}`,
      type: CompanyType.LOCAL,
      status: CompanyStatus.APPROVED,
      registrationNumber: `LC-${n}`,
      industryType: 'Construction',
      phone: `+9155500${n}`,
      location: 'Delhi',
      employeeRange: '10-50',
    },
  });
  await prisma.employerUser.create({
    data: { userId: user.id, companyId: company.id, isPrimary: true },
  });
  return { companyId: company.id, userId: user.id };
}

async function mkSub(
  companyId: string,
  o: { status: SubscriptionStatus; expiresAt: Date; graceEndsAt?: Date | null },
): Promise<string> {
  const sub = await prisma.subscription.create({
    data: {
      companyId,
      planId: proPlanId,
      status: o.status,
      startsAt: new Date(Date.now() - 30 * DAY_MS),
      expiresAt: o.expiresAt,
      graceEndsAt: o.graceEndsAt ?? null,
    },
  });
  return sub.id;
}

async function mkActiveJob(
  companyId: string,
  o: { publishedAt: Date; createdAt?: Date; title?: string },
): Promise<string> {
  const n = ++seq;
  const job = await prisma.job.create({
    data: {
      companyId,
      title: o.title ?? `LC Job ${n}`,
      employmentType: EmploymentType.FULL_TIME,
      market: JobMarket.LOCAL,
      location: 'Delhi',
      description: 'Lifecycle test job',
      categoryId,
      salaryMin: 100,
      salaryMax: 200,
      currency: Currency.INR,
      hoursPerDay: 8,
      daysPerWeek: 5,
      status: JobStatus.ACTIVE,
      publishedAt: o.publishedAt,
      ...(o.createdAt && { createdAt: o.createdAt }),
    },
  });
  return job.id;
}

const runSweep = () =>
  processor.process({ name: JOB_NAMES.SUBSCRIPTION_LIFECYCLE_SWEEP, id: 'sweep-test' } as BullJob);

const notificationsFor = (userId: string, type: string) =>
  prisma.notification.findMany({ where: { userId, type: type as never }, orderBy: { createdAt: 'asc' } });

// ── Reminders ─────────────────────────────────────────────────────────────────

describe('pre-expiry reminders (T-7 / T-1, ledger-deduped)', () => {
  gatedIt('T-7: ACTIVE sub expiring in 6 days → ONE SUBSCRIPTION_EXPIRING with {expiresAt, window:7}; re-run no-ops', async () => {
    const { companyId, userId } = await mkCompany();
    const expiresAt = daysFromNow(6);
    await mkSub(companyId, { status: SubscriptionStatus.ACTIVE, expiresAt });

    await runSweep();
    let rows = await notificationsFor(userId, 'SUBSCRIPTION_EXPIRING');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toMatchObject({ window: 7, expiresAt: expiresAt.toISOString() });

    // Same day OR next day: the {expiresAt, window} ledger key already exists → no duplicate.
    await runSweep();
    rows = await notificationsFor(userId, 'SUBSCRIPTION_EXPIRING');
    expect(rows).toHaveLength(1);
  });

  gatedIt('T-1: ACTIVE sub expiring in 12 hours → window-1 reminder (once)', async () => {
    const { companyId, userId } = await mkCompany();
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await mkSub(companyId, { status: SubscriptionStatus.ACTIVE, expiresAt });

    await runSweep();
    await runSweep();
    const rows = await notificationsFor(userId, 'SUBSCRIPTION_EXPIRING');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toMatchObject({ window: 1 });
  });

  gatedIt('renewalReminders=false → no reminder', async () => {
    const { companyId, userId } = await mkCompany();
    const subId = await mkSub(companyId, { status: SubscriptionStatus.ACTIVE, expiresAt: daysFromNow(5) });
    await prisma.subscription.update({ where: { id: subId }, data: { renewalReminders: false } });

    await runSweep();
    expect(await notificationsFor(userId, 'SUBSCRIPTION_EXPIRING')).toHaveLength(0);
  });
});

// ── ACTIVE → GRACE ────────────────────────────────────────────────────────────

describe('ACTIVE past expiresAt → GRACE', () => {
  gatedIt('sets GRACE + graceEndsAt = expiresAt + 7d, notifies with grace framing, audits; re-run no-ops', async () => {
    const { companyId, userId } = await mkCompany();
    const expiresAt = hoursAgo(2);
    const subId = await mkSub(companyId, { status: SubscriptionStatus.ACTIVE, expiresAt });

    await runSweep();

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } });
    expect(sub.status).toBe(SubscriptionStatus.GRACE);
    expect(sub.graceEndsAt!.getTime()).toBe(expiresAt.getTime() + 7 * DAY_MS);

    let notes = await notificationsFor(userId, 'SUBSCRIPTION_EXPIRED');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.data).toMatchObject({ phase: 'GRACE' });
    expect(notes[0]!.body).toContain('jobs stay live');

    const audits = await prisma.auditLog.findMany({
      where: { action: AUDIT_ACTIONS.SUBSCRIPTION_GRACE_STARTED, targetId: subId },
    });
    expect(audits).toHaveLength(1);

    // Idempotent: the row is GRACE now — a re-run must not re-transition or re-notify.
    await runSweep();
    notes = await notificationsFor(userId, 'SUBSCRIPTION_EXPIRED');
    expect(notes).toHaveLength(1);
    expect(
      await prisma.auditLog.count({
        where: { action: AUDIT_ACTIONS.SUBSCRIPTION_GRACE_STARTED, targetId: subId },
      }),
    ).toBe(1);
  });

  gatedIt('GRACE keeps jobs live — no pause happens at the GRACE transition', async () => {
    const { companyId } = await mkCompany();
    await mkSub(companyId, { status: SubscriptionStatus.ACTIVE, expiresAt: hoursAgo(1) });
    await mkActiveJob(companyId, { publishedAt: hoursAgo(48) });
    await mkActiveJob(companyId, { publishedAt: hoursAgo(24) });

    await runSweep();

    const active = await prisma.job.count({ where: { companyId, status: JobStatus.ACTIVE } });
    expect(active).toBe(2);
  });
});

// ── GRACE → EXPIRED + the pause rule ─────────────────────────────────────────

describe('GRACE past graceEndsAt → EXPIRED + pause-all-but-most-recent', () => {
  gatedIt('3 active jobs → the latest-PUBLISHED stays ACTIVE (not latest-created), 2 pause with audit rows', async () => {
    const { companyId, userId } = await mkCompany();
    const subId = await mkSub(companyId, {
      status: SubscriptionStatus.GRACE,
      expiresAt: daysFromNow(-8),
      graceEndsAt: hoursAgo(1),
    });
    // The survivor is the OLDEST-created job with the LATEST publishedAt —
    // proving "most recent" = publishedAt, not createdAt (a re-published old
    // draft counts as recent).
    const survivor = await mkActiveJob(companyId, {
      title: 'Re-published old draft',
      createdAt: new Date(Date.now() - 60 * DAY_MS),
      publishedAt: hoursAgo(1),
    });
    const paused1 = await mkActiveJob(companyId, { publishedAt: hoursAgo(48) });
    const paused2 = await mkActiveJob(companyId, { publishedAt: hoursAgo(24) });

    const counts = await runSweep();
    expect(counts.expired).toBeGreaterThanOrEqual(1);

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } });
    expect(sub.status).toBe(SubscriptionStatus.EXPIRED);

    const jobs = await prisma.job.findMany({
      where: { companyId },
      select: { id: true, status: true },
    });
    const byId = new Map(jobs.map((j) => [j.id, j.status]));
    expect(byId.get(survivor)).toBe(JobStatus.ACTIVE);
    expect(byId.get(paused1)).toBe(JobStatus.PAUSED);
    expect(byId.get(paused2)).toBe(JobStatus.PAUSED);

    // Each pause is an audited job.paused with the expiry reason.
    for (const id of [paused1, paused2]) {
      const rows = await prisma.auditLog.findMany({
        where: { action: AUDIT_ACTIONS.JOB_PAUSED, targetId: id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.meta).toMatchObject({ reason: 'subscription_expired' });
    }

    const notes = await notificationsFor(userId, 'SUBSCRIPTION_EXPIRED');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.data).toMatchObject({ phase: 'EXPIRED', jobsPaused: 2 });
    expect(notes[0]!.body).toContain('Free plan');

    // Re-run same day → no-ops: no new pauses, no new notifications.
    await runSweep();
    expect(await notificationsFor(userId, 'SUBSCRIPTION_EXPIRED')).toHaveLength(1);
    expect(
      await prisma.auditLog.count({ where: { action: AUDIT_ACTIONS.JOB_PAUSED, targetId: paused1 } }),
    ).toBe(1);
    expect(
      (await prisma.job.findUniqueOrThrow({ where: { id: survivor } })).status,
    ).toBe(JobStatus.ACTIVE);
  });

  gatedIt('1 active job → nothing pauses', async () => {
    const { companyId, userId } = await mkCompany();
    await mkSub(companyId, {
      status: SubscriptionStatus.GRACE,
      expiresAt: daysFromNow(-8),
      graceEndsAt: hoursAgo(1),
    });
    const only = await mkActiveJob(companyId, { publishedAt: hoursAgo(24) });

    await runSweep();

    expect((await prisma.job.findUniqueOrThrow({ where: { id: only } })).status).toBe(
      JobStatus.ACTIVE,
    );
    const notes = await notificationsFor(userId, 'SUBSCRIPTION_EXPIRED');
    expect(notes[0]!.data).toMatchObject({ jobsPaused: 0 });
  });

  gatedIt('renewal in GRACE → back to ACTIVE untouched by the sweep; expiry-paused jobs STAY paused (manual resume only); reminder ladder restarts on the new expiresAt', async () => {
    const { companyId, userId } = await mkCompany();
    const subId = await mkSub(companyId, {
      status: SubscriptionStatus.GRACE,
      expiresAt: daysFromNow(-8),
      graceEndsAt: hoursAgo(1),
    });
    await mkActiveJob(companyId, { publishedAt: hoursAgo(48) });
    await mkActiveJob(companyId, { publishedAt: hoursAgo(24) });

    await runSweep(); // → EXPIRED, 1 job paused

    // Renewal (what S5-B2's activation does): ACTIVE, fresh term, grace cleared.
    const newExpiresAt = daysFromNow(5); // inside the T-7 band — the ladder must fire again
    await prisma.subscription.update({
      where: { id: subId },
      data: { status: SubscriptionStatus.ACTIVE, expiresAt: newExpiresAt, graceEndsAt: null },
    });

    await runSweep();

    // Still ACTIVE — and the job paused by expiry is NOT auto-resumed.
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } });
    expect(sub.status).toBe(SubscriptionStatus.ACTIVE);
    expect(await prisma.job.count({ where: { companyId, status: JobStatus.PAUSED } })).toBe(1);

    // The NEW expiresAt is a NEW ledger key → a fresh T-7 reminder fires.
    const reminders = await notificationsFor(userId, 'SUBSCRIPTION_EXPIRING');
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.data).toMatchObject({
      window: 7,
      expiresAt: newExpiresAt.toISOString(),
    });
  });
});

// ── Sweep summary ─────────────────────────────────────────────────────────────

describe('sweep bookkeeping', () => {
  gatedIt('every run writes a subscription_lifecycle.run audit with counts only', async () => {
    const before = await prisma.auditLog.count({
      where: { action: AUDIT_ACTIONS.SUBSCRIPTION_LIFECYCLE_RUN },
    });
    await runSweep();
    const rows = await prisma.auditLog.findMany({
      where: { action: AUDIT_ACTIONS.SUBSCRIPTION_LIFECYCLE_RUN },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(
      await prisma.auditLog.count({ where: { action: AUDIT_ACTIONS.SUBSCRIPTION_LIFECYCLE_RUN } }),
    ).toBe(before + 1);
    expect(rows[0]!.meta).toMatchObject({
      graceStarted: expect.any(Number),
      reminder7: expect.any(Number),
      reminder1: expect.any(Number),
      expired: expect.any(Number),
      jobsPaused: expect.any(Number),
    });
  });

  gatedIt('email jobs go through the queue boundary (worker-and-external-sends) — never sent inline', async () => {
    queueAdd.mockClear();
    const { companyId } = await mkCompany();
    await mkSub(companyId, { status: SubscriptionStatus.ACTIVE, expiresAt: daysFromNow(6) });

    await runSweep();

    // SUBSCRIPTION_EXPIRING matrix row: in-app + email → exactly the email enqueue.
    const emailCalls = queueAdd.mock.calls.filter(
      ([, data]) => (data as { channel?: string }).channel === 'email',
    );
    expect(emailCalls.length).toBeGreaterThanOrEqual(1);
  });
});
