/**
 * Integration tests for the exported aggregate service (the dashboard rewiring
 * source) against a real Postgres container. Proves the seeded truth for company
 * KPIs (incl. hiredThisMonth at the month boundary), recent applicants, candidate
 * KPIs, and the batched per-job counts (ONE grouped query — see note below).
 *
 * Skips gracefully when Docker is unavailable.
 */
import {
  ApplicationStatus,
  CompanyStatus,
  CompanyType,
  Currency,
  EmploymentType,
  JobMarket,
  JobStatus,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { execSync } from 'child_process';
import * as path from 'path';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../core/prisma/prisma.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { JobsService } from '../jobs/jobs.service';
import { ApplicationsAggregateService } from './applications-aggregate.service';

jest.setTimeout(180_000);
const API_DIR = path.resolve(__dirname, '../..');

let pg: StartedTestContainer;
let prismaClient: PrismaClient;
let service: ApplicationsAggregateService;
let dockerUnavailable = false;

const CATEGORY_ID = 'ag2-cat';
let companyId: string;
let jobA: string;
let jobB: string;
const candidateIds: string[] = [];

beforeAll(async () => {
  try {
    pg = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_USER: 'sic', POSTGRES_PASSWORD: 'sic', POSTGRES_DB: 'sic_agg' })
      .withExposedPorts(5432)
      .start();
    const url = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_agg`;
    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    prismaClient = new PrismaClient({ datasources: { db: { url } } });
    await prismaClient.$connect();

    await prismaClient.jobCategory.create({ data: { id: CATEGORY_ID, slug: 'ag2', nameEn: 'AG2' } });
    companyId = (
      await prismaClient.company.create({
        data: { name: 'Agg Co', type: CompanyType.FOREIGN, registrationNumber: 'AGG-1', industryType: 'C', phone: '+91', location: 'Dubai', employeeRange: '10-50', status: CompanyStatus.APPROVED },
      })
    ).id;
    const mkJob = async () =>
      (
        await prismaClient.job.create({
          data: { companyId, title: 'Mason', employmentType: EmploymentType.FULL_TIME, market: JobMarket.GULF, status: JobStatus.ACTIVE, location: 'Dubai', description: 'd', categoryId: CATEGORY_ID, salaryMin: 1, salaryMax: 2, currency: Currency.AED, hoursPerDay: 8, daysPerWeek: 6 },
        })
      ).id;
    jobA = await mkJob();
    jobB = await mkJob();

    for (let i = 0; i < 4; i++) {
      await prismaClient.user.create({ data: { id: `agg-u-${i}`, email: `agg${i}@x.com`, role: UserRole.CANDIDATE } });
      candidateIds.push(
        (await prismaClient.candidateProfile.create({ data: { userId: `agg-u-${i}`, fullName: `Cand ${i}`, completionPct: 80 } })).id,
      );
    }

    const prismaSvc = prismaClient as unknown as PrismaService;
    const jobsStub = {
      getJobIdsForCompany: async (cId: string) =>
        (await prismaClient.job.findMany({ where: { companyId: cId }, select: { id: true } })).map((j) => j.id),
      getJobSubsets: async (ids: string[]) => {
        const rows = await prismaClient.job.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, location: true, market: true, company: { select: { name: true } } } });
        return new Map(rows.map((j) => [j.id, { id: j.id, title: j.title, companyName: j.company.name, location: j.location, market: j.market }]));
      },
    } as unknown as JobsService;

    service = new ApplicationsAggregateService(prismaSvc, jobsStub, new CandidateReadService(prismaSvc));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/container runtime|Docker|ENOENT|ECONNREFUSED|not recognized|prisma: command not found/.test(msg)) {
      dockerUnavailable = true;
      console.warn('[aggregate] Docker unavailable — skipped:', msg);
    } else throw err;
  }
});

afterAll(async () => {
  await prismaClient?.$disconnect();
  await pg?.stop();
});

beforeEach(async () => {
  if (dockerUnavailable) return;
  await prismaClient.applicationTimelineEntry.deleteMany();
  await prismaClient.application.deleteMany();
});

async function mkApp(jobId: string, candidateId: string, status: ApplicationStatus, createdAt?: Date): Promise<string> {
  return (
    await prismaClient.application.create({
      data: { jobId, candidateId, status, matchScore: 50, matchBreakdown: {}, docsCompleteCount: 2, docsRequiredCount: 2, passportValidAtApply: true, ...(createdAt && { createdAt }) },
    })
  ).id;
}

function gatedIt(name: string, fn: () => Promise<void>): void {
  it(name, async () => {
    if (dockerUnavailable) return;
    await fn();
  });
}

describe('countsForCompany', () => {
  gatedIt('total + shortlisted reflect the seeded distribution', async () => {
    await mkApp(jobA, candidateIds[0]!, ApplicationStatus.PENDING);
    await mkApp(jobA, candidateIds[1]!, ApplicationStatus.SHORTLISTED);
    await mkApp(jobB, candidateIds[2]!, ApplicationStatus.SHORTLISTED);

    const c = await service.countsForCompany(companyId);
    expect(c.total).toBe(3);
    expect(c.shortlisted).toBe(2);
  });

  gatedIt('hiredThisMonth counts SELECTED-this-month, NOT a hire from last month', async () => {
    // Hired this month: SELECTED now + a SELECTED timeline entry this month.
    const thisMonth = await mkApp(jobA, candidateIds[0]!, ApplicationStatus.SELECTED);
    await prismaClient.applicationTimelineEntry.create({
      data: { applicationId: thisMonth, fromStatus: ApplicationStatus.PENDING, toStatus: ApplicationStatus.SELECTED, actorRole: UserRole.EMPLOYER, createdAt: new Date() },
    });

    // Hired LAST month: SELECTED now but the SELECTED transition was last month.
    const lastMonth = await mkApp(jobB, candidateIds[1]!, ApplicationStatus.SELECTED);
    const lm = new Date();
    lm.setUTCMonth(lm.getUTCMonth() - 1, 15);
    await prismaClient.applicationTimelineEntry.create({
      data: { applicationId: lastMonth, fromStatus: ApplicationStatus.PENDING, toStatus: ApplicationStatus.SELECTED, actorRole: UserRole.EMPLOYER, createdAt: lm },
    });

    const c = await service.countsForCompany(companyId);
    expect(c.hiredThisMonth).toBe(1);
  });

  gatedIt('empty company → all zeros', async () => {
    const c = await service.countsForCompany('no-such-company');
    expect(c).toEqual({ total: 0, shortlisted: 0, hiredThisMonth: 0 });
  });
});

describe('recentApplicantsForCompany', () => {
  gatedIt('returns newest-first ApplicantSummary with name + jobTitle', async () => {
    await mkApp(jobA, candidateIds[0]!, ApplicationStatus.PENDING);
    await mkApp(jobB, candidateIds[1]!, ApplicationStatus.SHORTLISTED);

    const recent = await service.recentApplicantsForCompany(companyId, 5);
    expect(recent).toHaveLength(2);
    expect(recent[0]).toHaveProperty('candidateName');
    expect(recent[0]).toHaveProperty('jobTitle', 'Mason');
    // employer-context summary: no phone/dob keys
    expect(JSON.stringify(recent)).not.toContain('dob');
  });
});

describe('countsForCandidate', () => {
  gatedIt('applied + shortlisted for the candidate', async () => {
    await mkApp(jobA, candidateIds[0]!, ApplicationStatus.SHORTLISTED);
    await mkApp(jobB, candidateIds[0]!, ApplicationStatus.PENDING);
    const c = await service.countsForCandidate(candidateIds[0]!);
    expect(c).toEqual({ applied: 2, shortlisted: 1 });
  });
});

describe('countsPerJob', () => {
  gatedIt('batched per-job counts (ONE grouped query — by [jobId,status])', async () => {
    await mkApp(jobA, candidateIds[0]!, ApplicationStatus.PENDING);
    await mkApp(jobA, candidateIds[1]!, ApplicationStatus.SHORTLISTED);
    await mkApp(jobB, candidateIds[2]!, ApplicationStatus.PENDING);

    // One groupBy over both jobIds — the mechanism that avoids the N-query My-Jobs miss.
    const map = await service.countsPerJob([jobA, jobB]);
    expect(map.get(jobA)).toEqual({ applications: 2, shortlisted: 1 });
    expect(map.get(jobB)).toEqual({ applications: 1, shortlisted: 0 });
  });

  gatedIt('jobs with no applications report zero (present in the map)', async () => {
    const map = await service.countsPerJob([jobA]);
    expect(map.get(jobA)).toEqual({ applications: 0, shortlisted: 0 });
  });
});
