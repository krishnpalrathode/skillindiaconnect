/**
 * Admin dashboard KPIs (S6a-B1) on real Postgres.
 *
 * Proves: counts match seeded truth; revenue sums THIS month's invoices only
 * (the month-boundary case is the one that silently over-reports); and the whole
 * page costs a FIXED number of grouped queries — no N+1 hiding in a count.
 */
import {
  ApplicationStatus,
  CompanyStatus,
  CompanyType,
  Currency,
  EmploymentType,
  Gateway,
  JobMarket,
  JobStatus,
  OrderStatus,
  PlanPeriod,
  PrismaClient,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { execSync } from 'child_process';
import * as path from 'path';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../core/prisma/prisma.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { EmployerService } from '../employer/employer.service';
import { JobsService } from '../jobs/jobs.service';
import { ApplicationsAggregateService } from '../applications/applications-aggregate.service';
import { SubscriptionReadService } from '../payments/subscription-read.service';
import { SettingsService } from '../settings/settings.service';
import { AdminDashboardService } from './admin-dashboard.service';

jest.setTimeout(240_000);

const API_DIR = path.resolve(__dirname, '../..');

let pg: StartedTestContainer;
let prisma: PrismaClient;
let service: AdminDashboardService;
let dockerUnavailable = false;
let categoryId: string;
let companyId: string;
let dbUrl: string;
let seq = 0;

async function mkCompany(status: CompanyStatus): Promise<string> {
  const n = ++seq;
  const c = await prisma.company.create({
    data: {
      name: `Co ${n}`,
      type: CompanyType.LOCAL,
      status,
      registrationNumber: `R-${n}`,
      industryType: 'Construction',
      phone: `+9110000${n}`,
      location: 'Pune',
      employeeRange: '10-50',
    },
  });
  return c.id;
}

async function mkCandidate(status: UserStatus): Promise<string> {
  const n = ++seq;
  const user = await prisma.user.create({
    data: { email: `c-${n}@example.com`, role: UserRole.CANDIDATE, status },
  });
  const p = await prisma.candidateProfile.create({
    data: { userId: user.id, fullName: `Cand ${n}` },
  });
  return p.id;
}

async function mkJob(status: JobStatus): Promise<string> {
  const n = ++seq;
  const j = await prisma.job.create({
    data: {
      companyId,
      title: `Job ${n}`,
      employmentType: EmploymentType.FULL_TIME,
      market: JobMarket.LOCAL,
      location: 'Pune',
      description: 'x',
      categoryId,
      salaryMin: 100,
      salaryMax: 200,
      currency: Currency.INR,
      hoursPerDay: 8,
      daysPerWeek: 5,
      status,
    },
  });
  return j.id;
}

/** An invoiced order — the dashboard's revenue is keyed on the INVOICE's issuedAt. */
async function mkInvoicedOrder(totalSubunits: number, issuedAt: Date, planId: string) {
  const n = ++seq;
  const order = await prisma.order.create({
    data: {
      companyId,
      planId,
      gateway: Gateway.RAZORPAY,
      amountSubunits: totalSubunits,
      gstSubunits: 0,
      totalSubunits,
      currency: Currency.INR,
      status: OrderStatus.PAID,
    },
  });
  await prisma.invoice.create({
    data: { orderId: order.id, number: `SIC-2026-${String(n).padStart(5, '0')}`, issuedAt },
  });
}

beforeAll(async () => {
  try {
    pg = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_USER: 'sic',
        POSTGRES_PASSWORD: 'sic',
        POSTGRES_DB: 'sic_admin_dash',
      })
      .withExposedPorts(5432)
      .start();
    const url = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_admin_dash`;
    dbUrl = url;
    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();

    categoryId = (
      await prisma.jobCategory.create({ data: { slug: 'ad-general', nameEn: 'General' } })
    ).id;
    const plan = await prisma.plan.create({
      data: {
        code: 'PRO_MONTHLY',
        name: 'Pro Monthly',
        priceSubunits: 299_900,
        period: PlanPeriod.MONTHLY,
        features: [],
      },
    });

    // ── Seeded truth ────────────────────────────────────────────────────────
    companyId = await mkCompany(CompanyStatus.APPROVED); // the job/order owner
    await mkCompany(CompanyStatus.PENDING);
    await mkCompany(CompanyStatus.PENDING);
    await mkCompany(CompanyStatus.REJECTED);

    await mkCandidate(UserStatus.ACTIVE);
    await mkCandidate(UserStatus.ACTIVE);
    await mkCandidate(UserStatus.PENDING_DELETION); // counted in total, NOT in active

    await mkJob(JobStatus.ACTIVE);
    await mkJob(JobStatus.ACTIVE);
    await mkJob(JobStatus.PENDING_REVIEW);
    await mkJob(JobStatus.DRAFT);

    const jobId = await mkJob(JobStatus.ACTIVE);
    const mkApplication = (candidateId: string, status: ApplicationStatus, matchScore: number) =>
      prisma.application.create({
        data: {
          jobId,
          candidateId,
          status,
          matchScore,
          // The apply-time snapshot fields (S4-B1) are non-null on the model.
          matchBreakdown: {},
          docsCompleteCount: 2,
          docsRequiredCount: 2,
          passportValidAtApply: true,
        },
      });
    await mkApplication(await mkCandidate(UserStatus.ACTIVE), ApplicationStatus.PENDING, 50);
    await mkApplication(await mkCandidate(UserStatus.ACTIVE), ApplicationStatus.SELECTED, 80);

    // Revenue: two invoices THIS month (1,000 + 2,500) and one LAST month that
    // must NOT be counted — the month-boundary case.
    const now = new Date();
    await mkInvoicedOrder(1_000, new Date(now.getFullYear(), now.getMonth(), 1), plan.id);
    await mkInvoicedOrder(2_500, now, plan.id);
    await mkInvoicedOrder(9_999, new Date(now.getFullYear(), now.getMonth() - 1, 15), plan.id);

    // countByStatus / countsPlatformWide / countCandidates touch ONLY `prisma` —
    // the other collaborators are irrelevant to the aggregates under test, so
    // they're nulled (the established pattern for these narrow reads).
    const prismaSvc = prisma as unknown as PrismaService;
    const settingsStub = { get: async () => 1 } as unknown as SettingsService;
    service = new AdminDashboardService(
      new CandidateReadService(prismaSvc),
      new EmployerService(prismaSvc, null as never, { notify: jest.fn() } as never),
      new JobsService(
        prismaSvc,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
      ),
      new ApplicationsAggregateService(prismaSvc, null as never, null as never),
      new SubscriptionReadService(prismaSvc, settingsStub),
    );
  } catch {
    dockerUnavailable = true;
    // eslint-disable-next-line no-console
    console.warn('Docker unavailable — skipping admin-dashboard tests.');
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

describe('AdminDashboardService', () => {
  gatedIt('counts match the seeded truth (employers/jobs/applications by status)', async () => {
    const d = await service.getDashboard();

    expect(d.counts.employers).toMatchObject({
      PENDING: 2,
      APPROVED: 1,
      REJECTED: 1,
      SUSPENDED: 0, // zero-filled — a fixed tile set never loses a column
    });
    expect(d.counts.jobs).toMatchObject({
      ACTIVE: 3,
      PENDING_REVIEW: 1,
      DRAFT: 1,
      PAUSED: 0,
      ARCHIVED: 0,
    });
    expect(d.counts.applications).toMatchObject({
      PENDING: 1,
      SELECTED: 1,
      SHORTLISTED: 0,
      REJECTED: 0,
    });
  });

  gatedIt(
    'candidate count is the contract INTEGER: non-purged profiles (PENDING_DELETION still counted)',
    async () => {
      const d = await service.getDashboard();
      // The contract's counts.candidates is a NUMBER — the web dashboard renders
      // it directly, so an object here is a rendering crash (caught live in the
      // S6 happy-path pass). PENDING_DELETION profiles still count (not purged
      // yet); a purged tombstone would not.
      expect(d.counts.candidates).toBe(5); // 3 seeded + 2 applicants
    },
  );

  gatedIt('revenue sums THIS month only — last month is excluded (the boundary case)', async () => {
    const d = await service.getDashboard();
    expect(d.revenueThisMonthSubunits).toBe(3_500); // 1,000 + 2,500; NOT the 9,999
    expect(d.currency).toBe('INR');
  });

  gatedIt(
    'the two work-queue depths are derived from the count maps (no extra queries)',
    async () => {
      const d = await service.getDashboard();
      expect(d.pendingEmployerReviews).toBe(2);
      expect(d.pendingJobReviews).toBe(1);
      // Derived, not re-queried: they equal the corresponding map entries exactly.
      expect(d.pendingEmployerReviews).toBe(d.counts.employers['PENDING']);
      expect(d.pendingJobReviews).toBe(d.counts.jobs['PENDING_REVIEW']);
    },
  );

  gatedIt('NO N+1: the SQL statement count is FIXED and does not grow with the data', async () => {
    // The real proof — count the statements Prisma actually issues, twice, with
    // very different amounts of data. Every figure is a GROUP BY / aggregate
    // executed IN Postgres, so nothing is computed per-row and the count cannot
    // move. If someone later replaces a groupBy with a loop, this fails.
    const logging = new PrismaClient({
      datasources: { db: { url: dbUrl } },
      log: [{ emit: 'event', level: 'query' }],
    });
    await logging.$connect();

    let statements = 0;
    (logging as unknown as { $on: (e: 'query', cb: () => void) => void }).$on('query', () => {
      statements++;
    });

    const svc = new AdminDashboardService(
      new CandidateReadService(logging as unknown as PrismaService),
      new EmployerService(
        logging as unknown as PrismaService,
        null as never,
        { notify: jest.fn() } as never,
      ),
      new JobsService(
        logging as unknown as PrismaService,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
        null as never,
      ),
      new ApplicationsAggregateService(
        logging as unknown as PrismaService,
        null as never,
        null as never,
      ),
      new SubscriptionReadService(
        logging as unknown as PrismaService,
        {
          get: async () => 1,
        } as unknown as SettingsService,
      ),
    );

    statements = 0;
    await svc.getDashboard();
    const withSmallData = statements;

    // Grow the data by an order of magnitude.
    for (let i = 0; i < 30; i++) await mkJob(JobStatus.ACTIVE);

    statements = 0;
    await svc.getDashboard();
    const withMoreData = statements;

    expect(withSmallData).toBeGreaterThan(0);
    // THE assertion: identical statement count despite 30x more jobs.
    expect(withMoreData).toBe(withSmallData);

    await logging.$disconnect();
  });
});
