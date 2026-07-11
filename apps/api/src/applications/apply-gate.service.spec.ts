/**
 * Integration tests for the five-gate apply enforcement against a real Postgres
 * container. Proves each gate's code + meta IN ISOLATION and — critically — the
 * ORDER (a multi-failing fixture returns the FIRST gate's code, not a later one),
 * plus that the threshold is Settings-driven.
 *
 * Skips gracefully when Docker is unavailable (mirrors jobs.service.spec).
 */
import { ConflictException, HttpException } from '@nestjs/common';
import {
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
import { ApplyGateService, ApplyGateSettings } from './apply-gate.service';
import { CandidateApplyInputs } from '../candidate/candidate-read.service';
import { JobForApplication } from '../jobs/jobs.service';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');

let pg: StartedTestContainer;
let prismaClient: PrismaClient;
let gate: ApplyGateService;
let dockerUnavailable = false;

const CATEGORY_ID = 'ag-cat-1';
const EMPLOYER_USER_ID = 'ag-emp-1';
const CANDIDATE_USER_ID = 'ag-cand-1';
let companyId: string;
let activeJobId: string;
let draftJobId: string;
let candidateId: string;

const future = () => new Date(Date.now() + 365 * 24 * 3600 * 1000);
const past = () => new Date(Date.now() - 24 * 3600 * 1000);

beforeAll(async () => {
  try {
    pg = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_USER: 'sic',
        POSTGRES_PASSWORD: 'sic',
        POSTGRES_DB: 'sic_apply_gate',
      })
      .withExposedPorts(5432)
      .start();

    const url = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_apply_gate`;
    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });

    prismaClient = new PrismaClient({ datasources: { db: { url } } });
    await prismaClient.$connect();

    await prismaClient.jobCategory.upsert({
      where: { id: CATEGORY_ID },
      create: { id: CATEGORY_ID, slug: 'ag-general', nameEn: 'AG General' },
      update: {},
    });

    await prismaClient.user.upsert({
      where: { id: EMPLOYER_USER_ID },
      create: { id: EMPLOYER_USER_ID, email: 'ag-emp@example.com', role: UserRole.EMPLOYER },
      update: {},
    });
    const company = await prismaClient.company.create({
      data: {
        name: 'AG Co',
        type: CompanyType.FOREIGN,
        registrationNumber: 'AG-REG-1',
        industryType: 'Construction',
        phone: '+91100',
        location: 'Dubai',
        employeeRange: '10-50',
        status: CompanyStatus.APPROVED,
      },
    });
    companyId = company.id;
    await prismaClient.employerUser.upsert({
      where: { userId: EMPLOYER_USER_ID },
      create: { userId: EMPLOYER_USER_ID, companyId, isPrimary: true },
      update: {},
    });

    const jobData = (status: JobStatus) => ({
      companyId,
      title: 'Mason',
      employmentType: EmploymentType.FULL_TIME,
      market: JobMarket.GULF,
      status,
      location: 'Dubai',
      description: 'desc',
      categoryId: CATEGORY_ID,
      experienceRequiredYears: 3,
      salaryMin: 1000,
      salaryMax: 2000,
      currency: Currency.AED,
      hoursPerDay: 8,
      daysPerWeek: 6,
    });
    activeJobId = (await prismaClient.job.create({ data: jobData(JobStatus.ACTIVE) })).id;
    draftJobId = (await prismaClient.job.create({ data: jobData(JobStatus.DRAFT) })).id;

    await prismaClient.user.upsert({
      where: { id: CANDIDATE_USER_ID },
      create: { id: CANDIDATE_USER_ID, email: 'ag-cand@example.com', role: UserRole.CANDIDATE },
      update: {},
    });
    const profile = await prismaClient.candidateProfile.create({
      data: {
        userId: CANDIDATE_USER_ID,
        fullName: 'Amir',
        completionPct: 80,
        jobCategoryId: CATEGORY_ID,
      },
    });
    candidateId = profile.id;

    gate = new ApplyGateService(prismaClient as unknown as PrismaService);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('container runtime') ||
      msg.includes('Docker') ||
      msg.includes('ENOENT') ||
      msg.includes('connect ECONNREFUSED') ||
      msg.includes('not recognized') ||
      msg.includes('prisma: command not found')
    ) {
      dockerUnavailable = true;
      console.warn('[apply-gate] Docker unavailable — tests will be skipped:', msg);
    } else {
      throw err;
    }
  }
});

afterAll(async () => {
  await prismaClient?.$disconnect();
  await pg?.stop();
});

beforeEach(async () => {
  if (dockerUnavailable) return;
  await prismaClient.application.deleteMany();
});

const SETTINGS: ApplyGateSettings = {
  minCompletionPct: 70,
  mandatoryDocs: [DocumentType.PASSPORT, DocumentType.EXPERIENCE_CERT],
};

function candidate(overrides: Partial<CandidateApplyInputs> = {}): CandidateApplyInputs {
  return {
    candidateId,
    completionPct: 80,
    categoryId: CATEGORY_ID,
    totalExperienceYears: 5,
    hasForeignExperience: true,
    documents: [
      { type: DocumentType.PASSPORT, expiryDate: future() },
      { type: DocumentType.EXPERIENCE_CERT, expiryDate: null },
    ],
    ...overrides,
  };
}

function job(overrides: Partial<JobForApplication> = {}): JobForApplication {
  return {
    id: activeJobId,
    status: JobStatus.ACTIVE,
    market: JobMarket.GULF,
    categoryId: CATEGORY_ID,
    experienceRequiredYears: 3,
    companyId,
    title: 'Mason',
    ...overrides,
  };
}

async function expectGate(
  promise: Promise<unknown>,
  code: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await promise;
    throw new Error('expected the gate to throw');
  } catch (e) {
    if (!(e instanceof HttpException)) throw e;
    const body = e.getResponse() as { code: string; meta?: Record<string, unknown> };
    expect(body.code).toBe(code);
    if (meta) expect(body.meta).toMatchObject(meta);
  }
}

// Runtime guard: dockerUnavailable is only known after beforeAll, so the check
// must live INSIDE the test body (collection-time it.skip would be too early).
function gatedIt(name: string, fn: () => Promise<void>): void {
  it(name, async () => {
    if (dockerUnavailable) return;
    await fn();
  });
}

describe('ApplyGateService (integration)', () => {
  // ── Isolated gates ──────────────────────────────────────────────────────────
  gatedIt('gate 1 — non-ACTIVE job → JOB_NOT_ACTIVE', async () => {
    await expectGate(
      gate.assertCanApply(candidate(), job({ id: draftJobId, status: JobStatus.DRAFT }), SETTINGS),
      'JOB_NOT_ACTIVE',
    );
  });

  gatedIt('gate 2 — existing application → ALREADY_APPLIED (409)', async () => {
    await prismaClient.application.create({
      data: {
        jobId: activeJobId,
        candidateId,
        matchScore: 50,
        matchBreakdown: {},
        docsCompleteCount: 2,
        docsRequiredCount: 2,
        passportValidAtApply: true,
      },
    });
    const p = gate.assertCanApply(candidate(), job(), SETTINGS);
    await expect(p).rejects.toBeInstanceOf(ConflictException);
    await expectGate(
      gate.assertCanApply(candidate(), job(), SETTINGS),
      'ALREADY_APPLIED',
    );
  });

  gatedIt('gate 3 — low completion → PROFILE_INCOMPLETE with {completionPct, threshold}', async () => {
    await expectGate(
      gate.assertCanApply(candidate({ completionPct: 50 }), job(), SETTINGS),
      'PROFILE_INCOMPLETE',
      { completionPct: 50, threshold: 70 },
    );
  });

  gatedIt('gate 4 — missing mandatory doc → MANDATORY_DOCS_MISSING with missing[]', async () => {
    await expectGate(
      gate.assertCanApply(
        candidate({ documents: [{ type: DocumentType.PASSPORT, expiryDate: future() }] }),
        job(),
        SETTINGS,
      ),
      'MANDATORY_DOCS_MISSING',
      { missing: [DocumentType.EXPERIENCE_CERT] },
    );
  });

  gatedIt('gate 5 — expired passport → PASSPORT_INVALID reason=expired', async () => {
    await expectGate(
      gate.assertCanApply(
        candidate({
          documents: [
            { type: DocumentType.PASSPORT, expiryDate: past() },
            { type: DocumentType.EXPERIENCE_CERT, expiryDate: null },
          ],
        }),
        job(),
        SETTINGS,
      ),
      'PASSPORT_INVALID',
      { reason: 'expired' },
    );
  });

  gatedIt('gate 5 — passport absent (not mandatory) → PASSPORT_INVALID reason=missing', async () => {
    await expectGate(
      gate.assertCanApply(
        candidate({ documents: [{ type: DocumentType.EXPERIENCE_CERT, expiryDate: null }] }),
        job(),
        { minCompletionPct: 70, mandatoryDocs: [DocumentType.EXPERIENCE_CERT] },
      ),
      'PASSPORT_INVALID',
      { reason: 'missing' },
    );
  });

  // ── ORDER (multi-failing fixtures) ──────────────────────────────────────────
  gatedIt('order — inactive job + incomplete profile → JOB_NOT_ACTIVE (gate 1 first)', async () => {
    await expectGate(
      gate.assertCanApply(
        candidate({ completionPct: 10 }),
        job({ id: draftJobId, status: JobStatus.DRAFT }),
        SETTINGS,
      ),
      'JOB_NOT_ACTIVE',
    );
  });

  gatedIt('order — docs missing + expired passport → MANDATORY_DOCS_MISSING (gate 4 before 5)', async () => {
    await expectGate(
      gate.assertCanApply(
        // only an expired passport present: EXPERIENCE_CERT missing (gate 4) AND
        // passport expired (gate 5) — gate 4 must win.
        candidate({ documents: [{ type: DocumentType.PASSPORT, expiryDate: past() }] }),
        job(),
        SETTINGS,
      ),
      'MANDATORY_DOCS_MISSING',
      { missing: [DocumentType.EXPERIENCE_CERT] },
    );
  });

  // ── Settings-driven threshold ───────────────────────────────────────────────
  gatedIt('settings — raising MIN_COMPLETION_PCT flips a passing candidate to PROFILE_INCOMPLETE', async () => {
    // completion 75 passes at min 70 …
    const pass = await gate.assertCanApply(candidate({ completionPct: 75 }), job(), {
      ...SETTINGS,
      minCompletionPct: 70,
    });
    expect(pass).toEqual({ docsPresentCount: 2, docsRequiredCount: 2 });

    // … and fails once the threshold is raised to 80.
    await expectGate(
      gate.assertCanApply(candidate({ completionPct: 75 }), job(), {
        ...SETTINGS,
        minCompletionPct: 80,
      }),
      'PROFILE_INCOMPLETE',
      { completionPct: 75, threshold: 80 },
    );
  });

  // ── Happy path ──────────────────────────────────────────────────────────────
  gatedIt('pass — returns docs present/required counts', async () => {
    const result = await gate.assertCanApply(candidate(), job(), SETTINGS);
    expect(result).toEqual({ docsPresentCount: 2, docsRequiredCount: 2 });
  });
});
