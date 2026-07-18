/**
 * Integration tests for the read surfaces against a real Postgres container.
 *
 * Focus (the review's key checks, all on RAW JSON):
 *  - candidate list filtering + stable cursor + own-scoping 404
 *  - candidate detail timeline SHAPING — overrideReason + actorUserId keys ABSENT
 *  - applicants: ownership 404, match-sort, counts, PRIVACY INHERITANCE (composed
 *    S3 mapper — no phone key, no dob, docs status-only), and the SNAPSHOT lock
 *    (edit the profile → matchBreakdown unchanged)
 *  - admin offset paging + filters
 *
 * Skips gracefully when Docker is unavailable.
 */
import { NotFoundException } from '@nestjs/common';
import {
  ApplicationStatus,
  CompanyStatus,
  CompanyType,
  Currency,
  DocumentType,
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
import { StorageService } from '../core/storage/storage.service';
import { ApplicationsReadService } from './applications-read.service';

jest.setTimeout(180_000);
const API_DIR = path.resolve(__dirname, '../..');

let pg: StartedTestContainer;
let prismaClient: PrismaClient;
let service: ApplicationsReadService;
let dockerUnavailable = false;

const CATEGORY_ID = 'rd-cat-1';
let companyId: string;
let otherCompanyId: string;
let jobId: string;
let otherJobId: string;
let candidateId: string;

beforeAll(async () => {
  try {
    pg = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_USER: 'sic', POSTGRES_PASSWORD: 'sic', POSTGRES_DB: 'sic_read' })
      .withExposedPorts(5432)
      .start();
    const url = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_read`;
    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    prismaClient = new PrismaClient({ datasources: { db: { url } } });
    await prismaClient.$connect();

    await prismaClient.jobCategory.create({ data: { id: CATEGORY_ID, slug: 'rd', nameEn: 'RD' } });
    const mkCompany = async (reg: string) =>
      (
        await prismaClient.company.create({
          data: {
            name: `Co ${reg}`,
            type: CompanyType.FOREIGN,
            registrationNumber: reg,
            industryType: 'C',
            phone: '+91',
            location: 'Dubai',
            employeeRange: '10-50',
            status: CompanyStatus.APPROVED,
          },
        })
      ).id;
    companyId = await mkCompany('RD-1');
    otherCompanyId = await mkCompany('RD-2');
    const mkJob = async (cId: string) =>
      (
        await prismaClient.job.create({
          data: {
            companyId: cId,
            title: 'Mason',
            employmentType: EmploymentType.FULL_TIME,
            market: JobMarket.GULF,
            status: JobStatus.ACTIVE,
            location: 'Dubai',
            description: 'd',
            categoryId: CATEGORY_ID,
            salaryMin: 1,
            salaryMax: 2,
            currency: Currency.AED,
            hoursPerDay: 8,
            daysPerWeek: 6,
          },
        })
      ).id;
    jobId = await mkJob(companyId);
    otherJobId = await mkJob(otherCompanyId);

    // Candidate with showPhone=false (privacy), a dob, and a passport doc.
    await prismaClient.user.create({ data: { id: 'rd-cand-u', email: 'rd@x.com', role: UserRole.CANDIDATE } });
    candidateId = (
      await prismaClient.candidateProfile.create({
        data: {
          userId: 'rd-cand-u',
          fullName: 'Amir Khan',
          phone: '+919876543210',
          showPhone: false,
          dob: new Date('1995-01-01'),
          jobCategoryId: CATEGORY_ID,
          completionPct: 80,
          documents: {
            create: [
              { type: DocumentType.PASSPORT, r2Key: 'k', fileName: 'p', mimeType: 'application/pdf', sizeBytes: 1, expiryDate: new Date('2030-01-01') },
            ],
          },
        },
      })
    ).id;

    const prismaSvc = prismaClient as unknown as PrismaService;
    const jobsStub = {
      getJobForApplication: async (id: string) => {
        const j = await prismaClient.job.findUnique({
          where: { id },
          select: { id: true, status: true, market: true, categoryId: true, experienceRequiredYears: true, companyId: true, title: true },
        });
        if (!j) throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
        return j;
      },
      getJobSubsets: async (ids: string[]) => {
        const rows = await prismaClient.job.findMany({
          where: { id: { in: ids } },
          select: { id: true, title: true, location: true, market: true, company: { select: { name: true } } },
        });
        return new Map(rows.map((j) => [j.id, { id: j.id, title: j.title, companyName: j.company.name, location: j.location, market: j.market }]));
      },
    } as unknown as JobsService;
    const storageStub = { presignGet: async () => null } as unknown as StorageService;

    service = new ApplicationsReadService(prismaSvc, jobsStub, new CandidateReadService(prismaSvc), storageStub);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/container runtime|Docker|ENOENT|ECONNREFUSED|not recognized|prisma: command not found/.test(msg)) {
      dockerUnavailable = true;
      console.warn('[read-service] Docker unavailable — skipped:', msg);
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

async function mkApp(
  jId: string,
  status: ApplicationStatus,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  return (
    await prismaClient.application.create({
      data: {
        jobId: jId,
        candidateId,
        status,
        matchScore: 70,
        matchBreakdown: { category: { score: 40, max: 40 }, experienceYears: { raw: 0, clamped: 0, score: 0, max: 30 }, foreignExperience: { score: 20, max: 20 }, documents: { score: 10, max: 10 } },
        docsCompleteCount: 2,
        docsRequiredCount: 2,
        passportValidAtApply: true,
        ...overrides,
      },
    })
  ).id;
}

function gatedIt(name: string, fn: () => Promise<void>): void {
  it(name, async () => {
    if (dockerUnavailable) return;
    await fn();
  });
}

describe('candidate applications list + detail', () => {
  gatedIt('filters by status and returns cards with the public job subset', async () => {
    await mkApp(jobId, ApplicationStatus.PENDING);
    await mkApp(otherJobId, ApplicationStatus.SHORTLISTED);

    const all = await service.listCandidateApplications(candidateId, {});
    expect(all.data).toHaveLength(2);
    expect(all.data[0]!.job).toHaveProperty('companyName');
    expect(all.data[0]!.job).not.toHaveProperty('companyId');

    const short = await service.listCandidateApplications(candidateId, { status: ApplicationStatus.SHORTLISTED });
    expect(short.data).toHaveLength(1);
    expect(short.data[0]!.status).toBe(ApplicationStatus.SHORTLISTED);
  });

  gatedIt('paginates stably with a cursor (no dup/skip across pages)', async () => {
    // The (jobId, candidateId) unique caps this candidate at one app per job, so
    // seed across the two jobs and assert the cursor mechanics on the 2-row feed.
    await mkApp(jobId, ApplicationStatus.PENDING);
    await mkApp(otherJobId, ApplicationStatus.PENDING);

    const p1 = await service.listCandidateApplications(candidateId, { limit: 1 });
    expect(p1.data).toHaveLength(1);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await service.listCandidateApplications(candidateId, { limit: 1, cursor: p1.nextCursor! });
    expect(p2.data).toHaveLength(1);
    expect(p2.data[0]!.id).not.toBe(p1.data[0]!.id);
  });

  gatedIt('detail: another candidate\'s application → 404', async () => {
    const id = await mkApp(jobId, ApplicationStatus.PENDING);
    await expect(
      service.getCandidateApplicationDetail('some-other-candidate-id', id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  gatedIt('detail timeline SHAPING: overrideReason + actorUserId ABSENT on raw JSON', async () => {
    const id = await mkApp(jobId, ApplicationStatus.SELECTED);
    // Seed a timeline entry that HAS an admin override reason + actor identity.
    await prismaClient.applicationTimelineEntry.create({
      data: {
        applicationId: id,
        fromStatus: ApplicationStatus.PENDING,
        toStatus: ApplicationStatus.SELECTED,
        actorUserId: 'admin-secret-id',
        actorRole: UserRole.ADMIN,
        isAdminOverride: true,
        overrideReason: 'internal override reason',
      },
    });

    const detail = await service.getCandidateApplicationDetail(candidateId, id);
    expect(detail.timeline).toHaveLength(1);
    const raw = JSON.stringify(detail.timeline[0]);
    expect(raw).not.toContain('overrideReason');
    expect(raw).not.toContain('internal override reason');
    expect(raw).not.toContain('actorUserId');
    expect(raw).not.toContain('admin-secret-id');
    // But the shaped fields ARE present.
    expect(detail.timeline[0]!.isAdminOverride).toBe(true);
    expect(detail.timeline[0]!.actorRole).toBe(UserRole.ADMIN);
  });
});

describe('employer applicants', () => {
  gatedIt('ownership: a job on another company → 404', async () => {
    await expect(service.listJobApplicants(otherJobId, companyId, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  gatedIt('privacy INHERITANCE (composed S3 mapper): no phone key, no dob, docs status-only', async () => {
    await mkApp(jobId, ApplicationStatus.PENDING);
    const res = await service.listJobApplicants(jobId, companyId, {});
    expect(res.data).toHaveLength(1);
    const raw = JSON.stringify(res.data[0]);
    // showPhone=false → phone key ABSENT (not null)
    expect('phone' in res.data[0]!).toBe(false);
    expect(raw).not.toContain('9876543210');
    // dob NEVER serialized
    expect(raw).not.toContain('dob');
    expect(raw).not.toContain('1995-01-01');
    // documents are status-only (no r2Key)
    expect(raw).not.toContain('r2Key');
    expect(res.data[0]!.documentsStatus.length).toBeGreaterThan(0);
  });

  gatedIt('counts match the seeded distribution', async () => {
    await mkApp(jobId, ApplicationStatus.PENDING);
    const res = await service.listJobApplicants(jobId, companyId, {});
    expect(res.counts).toEqual({ pending: 1, shortlisted: 0, selected: 0, rejected: 0 });
  });

  gatedIt('SNAPSHOT lock: editing the candidate profile leaves matchBreakdown unchanged', async () => {
    await mkApp(jobId, ApplicationStatus.PENDING);
    const before = (await service.listJobApplicants(jobId, companyId, {})).data[0]!.matchBreakdown;

    // Mutate the candidate's category + add experience — inputs that would change a
    // recomputed score. The snapshot must NOT move.
    await prismaClient.candidateProfile.update({ where: { id: candidateId }, data: { jobCategoryId: null } });
    await prismaClient.workExperience.create({
      data: { candidateId, type: 'FOREIGN', country: 'UAE', companyName: 'X', role: 'M', years: 9, months: 0 },
    });

    const after = (await service.listJobApplicants(jobId, companyId, {})).data[0]!.matchBreakdown;
    expect(after).toEqual(before);
    // restore
    await prismaClient.candidateProfile.update({ where: { id: candidateId }, data: { jobCategoryId: CATEGORY_ID } });
    await prismaClient.workExperience.deleteMany({ where: { candidateId } });
  });

  gatedIt('match sort orders by matchScore desc across applicants (stable)', async () => {
    // Two DIFFERENT candidates on the SAME job (the applicants list is per-job).
    await prismaClient.user.upsert({
      where: { id: 'rd-cand-2' },
      create: { id: 'rd-cand-2', email: 'rd2@x.com', role: UserRole.CANDIDATE },
      update: {},
    });
    const cand2 = (
      await prismaClient.candidateProfile.upsert({
        where: { userId: 'rd-cand-2' },
        create: { userId: 'rd-cand-2', fullName: 'Bilal', completionPct: 50 },
        update: {},
      })
    ).id;
    await mkApp(jobId, ApplicationStatus.PENDING, { matchScore: 30 });
    await prismaClient.application.create({
      data: {
        jobId,
        candidateId: cand2,
        status: ApplicationStatus.PENDING,
        matchScore: 95,
        matchBreakdown: {},
        docsCompleteCount: 2,
        docsRequiredCount: 2,
        passportValidAtApply: true,
      },
    });

    const res = await service.listJobApplicants(jobId, companyId, { sort: 'match' });
    expect(res.data.map((d) => d.matchScore)).toEqual([95, 30]);
  });
});

describe('admin applications', () => {
  gatedIt('offset paging + status filter', async () => {
    await mkApp(jobId, ApplicationStatus.PENDING);
    await mkApp(otherJobId, ApplicationStatus.SHORTLISTED);

    const page1 = await service.listAdminApplications({ page: 1, pageSize: 1 });
    expect(page1.data).toHaveLength(1);
    expect(page1.meta.total).toBe(2);
    expect(page1.meta.totalPages).toBe(2);

    const shortlisted = await service.listAdminApplications({ status: ApplicationStatus.SHORTLISTED });
    expect(shortlisted.data).toHaveLength(1);
    expect(shortlisted.data[0]!.candidateName).toBe('Amir Khan');
    // admin card carries candidate name + ids, no document keys
    expect(JSON.stringify(shortlisted.data[0])).not.toContain('r2Key');
  });
});
