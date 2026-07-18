/**
 * Integration tests for ApplyService against a real Postgres container.
 *
 * Proves: the happy path writes ONE row with a DB-assigned humanId (AP-YYYY-N),
 * the snapshot fields, and the exact match breakdown; the CONCURRENT double-apply
 * resolves via the (jobId, candidateId) unique → P2002 → exactly one 201 + one
 * 409 ALREADY_APPLIED; both in-app receipts are written with NO WhatsApp/email
 * rows (in-app tier only at apply).
 *
 * Skips gracefully when Docker is unavailable.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CompanyStatus,
  CompanyType,
  Currency,
  DocumentType,
  EmploymentType,
  ExperienceType,
  JobMarket,
  JobStatus,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { execSync } from 'child_process';
import * as path from 'path';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../core/prisma/prisma.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { EmployerService } from '../employer/employer.service';
import { JobsService } from '../jobs/jobs.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../audit/audit.service';
import { ApplyGateService } from './apply-gate.service';
import { MatchService } from './match/match.service';
import { ApplyService } from './apply.service';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');

let pg: StartedTestContainer;
let prismaClient: PrismaClient;
let service: ApplyService;
let dockerUnavailable = false;

const CATEGORY_ID = 'as-cat-1';
const EMPLOYER_USER_ID = 'as-emp-1';
const CANDIDATE_USER_ID = 'as-cand-1';
let companyId: string;
let jobId: string;

beforeAll(async () => {
  try {
    pg = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_USER: 'sic',
        POSTGRES_PASSWORD: 'sic',
        POSTGRES_DB: 'sic_apply_svc',
      })
      .withExposedPorts(5432)
      .start();

    const url = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_apply_svc`;
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
      create: { id: CATEGORY_ID, slug: 'as-general', nameEn: 'AS General' },
      update: {},
    });

    await prismaClient.user.create({
      data: { id: EMPLOYER_USER_ID, email: 'as-emp@example.com', role: UserRole.EMPLOYER },
    });
    const company = await prismaClient.company.create({
      data: {
        name: 'AS Co',
        type: CompanyType.FOREIGN,
        registrationNumber: 'AS-REG-1',
        industryType: 'Construction',
        phone: '+91100',
        location: 'Dubai',
        employeeRange: '10-50',
        status: CompanyStatus.APPROVED,
      },
    });
    companyId = company.id;
    await prismaClient.employerUser.create({
      data: { userId: EMPLOYER_USER_ID, companyId, isPrimary: true },
    });

    jobId = (
      await prismaClient.job.create({
        data: {
          companyId,
          title: 'Mason',
          employmentType: EmploymentType.FULL_TIME,
          market: JobMarket.GULF,
          status: JobStatus.ACTIVE,
          location: 'Dubai',
          description: 'desc',
          categoryId: CATEGORY_ID,
          experienceRequiredYears: 3,
          salaryMin: 1000,
          salaryMax: 2000,
          currency: Currency.AED,
          hoursPerDay: 8,
          daysPerWeek: 6,
        },
      })
    ).id;

    // Candidate that PASSES every gate: completion 80, valid passport + exp cert,
    // 5y foreign experience, category matches.
    await prismaClient.user.create({
      data: { id: CANDIDATE_USER_ID, email: 'as-cand@example.com', role: UserRole.CANDIDATE },
    });
    const profile = await prismaClient.candidateProfile.create({
      data: {
        userId: CANDIDATE_USER_ID,
        fullName: 'Amir',
        completionPct: 80,
        jobCategoryId: CATEGORY_ID,
        experiences: {
          create: [
            { type: ExperienceType.FOREIGN, country: 'UAE', companyName: 'X', role: 'Mason', years: 5, months: 0 },
          ],
        },
        documents: {
          create: [
            {
              type: DocumentType.PASSPORT,
              r2Key: 'k/p',
              fileName: 'p.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1,
              expiryDate: new Date(Date.now() + 365 * 24 * 3600 * 1000),
            },
            {
              type: DocumentType.EXPERIENCE_CERT,
              r2Key: 'k/e',
              fileName: 'e.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1,
            },
          ],
        },
      },
    });
    void profile;

    // ── Wire the service with real deps + Redis-free stubs ──────────────────
    const prismaSvc = prismaClient as unknown as PrismaService;
    const candidateRead = new CandidateReadService(prismaSvc);
    const employerService = new EmployerService(prismaSvc, null as never);
    const applyGate = new ApplyGateService(prismaSvc);
    const matchService = new MatchService();
    const auditService = new AuditService(prismaSvc);
    const eventEmitter = new EventEmitter2();

    // notifyInApp only touches Prisma — a stub queue proves nothing is enqueued.
    const stubQueue = { add: jest.fn() } as unknown as Queue;
    const notificationService = new NotificationService(prismaSvc, stubQueue);

    // Only getJobForApplication is used — a thin stub avoids constructing all of JobsService.
    const jobsServiceStub = {
      getJobForApplication: async (id: string) => {
        const j = await prismaClient.job.findUnique({
          where: { id },
          select: {
            id: true,
            status: true,
            market: true,
            categoryId: true,
            experienceRequiredYears: true,
            companyId: true,
            title: true,
          },
        });
        if (!j) throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
        return j;
      },
    } as unknown as JobsService;

    const settingsStub = {
      get: jest.fn(async (keyDef: { key: string }) => {
        if (keyDef.key === 'candidates.min_completion_pct') return 70;
        if (keyDef.key === 'candidates.mandatory_documents')
          return [DocumentType.PASSPORT, DocumentType.EXPERIENCE_CERT];
        throw new Error(`unexpected setting ${keyDef.key}`);
      }),
    } as unknown as SettingsService;

    service = new ApplyService(
      prismaSvc,
      candidateRead,
      jobsServiceStub,
      employerService,
      settingsStub,
      applyGate,
      matchService,
      notificationService,
      auditService,
      eventEmitter,
    );
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
      console.warn('[apply-service] Docker unavailable — tests will be skipped:', msg);
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
  await prismaClient.notification.deleteMany();
  await prismaClient.whatsappMessage.deleteMany();
  await prismaClient.emailMessage.deleteMany();
  await prismaClient.auditLog.deleteMany();
});

// Runtime guard: dockerUnavailable is only known after beforeAll, so the check
// must live INSIDE the test body (collection-time it.skip would be too early).
function gatedIt(name: string, fn: () => Promise<void>): void {
  it(name, async () => {
    if (dockerUnavailable) return;
    await fn();
  });
}

describe('ApplyService (integration)', () => {
  gatedIt('happy path — creates one PENDING row with DB-assigned AP-YYYY-N + snapshot + breakdown', async () => {
    const res = await service.apply(CANDIDATE_USER_ID, jobId, { coverLetter: 'Hire me' }, UserRole.CANDIDATE);

    expect(res.status).toBe('PENDING');
    expect(res.humanId).toMatch(/^AP-\d{4}-\d+$/);
    expect(res.coverLetter).toBe('Hire me');
    expect(res.docsCompleteCount).toBe(2);
    expect(res.docsRequiredCount).toBe(2);
    expect(res.passportValidAtApply).toBe(true);

    // Exact snapshot: category 40 (match) + exp 30 (5y ≥ 3 req) + foreign 20 (GULF) + docs 10 = 100
    expect(res.matchScore).toBe(100);
    expect(res.matchBreakdown).toEqual({
      category: { score: 40, max: 40 },
      experienceYears: { raw: 5, clamped: 5, score: 30, max: 30 },
      foreignExperience: { score: 20, max: 20 },
      documents: { score: 10, max: 10 },
    });
    // overrideReason is admin-context-only — must be absent from the candidate response.
    expect('overrideReason' in res).toBe(false);

    const rows = await prismaClient.application.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.humanId).toBe(res.humanId);
    expect(rows[0]!.status).toBe('PENDING');
  });

  gatedIt('creates BOTH in-app receipts and NO whatsapp/email rows', async () => {
    await service.apply(CANDIDATE_USER_ID, jobId, {}, UserRole.CANDIDATE);

    const candidateNotifs = await prismaClient.notification.count({ where: { userId: CANDIDATE_USER_ID } });
    const employerNotifs = await prismaClient.notification.count({ where: { userId: EMPLOYER_USER_ID } });
    expect(candidateNotifs).toBe(1);
    expect(employerNotifs).toBe(1);

    // In-app tier only — the worker channels are never touched at apply.
    expect(await prismaClient.whatsappMessage.count()).toBe(0);
    expect(await prismaClient.emailMessage.count()).toBe(0);
  });

  gatedIt('writes an audit row for application.created (ids-only meta)', async () => {
    const res = await service.apply(CANDIDATE_USER_ID, jobId, {}, UserRole.CANDIDATE);
    const audits = await prismaClient.auditLog.findMany({ where: { action: 'application.created' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.targetId).toBe(res.id);
    expect(audits[0]!.module).toBe('Applications');
  });

  gatedIt('unknown job → 404 JOB_NOT_FOUND', async () => {
    await expect(
      service.apply(CANDIDATE_USER_ID, '00000000-0000-0000-0000-000000000000', {}, UserRole.CANDIDATE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  gatedIt('concurrent double-apply → exactly ONE row, one success + one 409 ALREADY_APPLIED (P2002)', async () => {
    const results = await Promise.allSettled([
      service.apply(CANDIDATE_USER_ID, jobId, {}, UserRole.CANDIDATE),
      service.apply(CANDIDATE_USER_ID, jobId, {}, UserRole.CANDIDATE),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConflictException);
    expect((rejected[0]!.reason as ConflictException).getResponse()).toMatchObject({
      code: 'ALREADY_APPLIED',
    });

    // The unique constraint is the guarantee — exactly one row exists.
    expect(await prismaClient.application.count()).toBe(1);
  });
});
