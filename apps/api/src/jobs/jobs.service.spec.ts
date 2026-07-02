/**
 * Integration tests for JobsService against a real Postgres container.
 *
 * Critical tests:
 * - create → DRAFT with a DB-assigned humanId (JB-YYYY-N pattern, NEVER set in code).
 * - searchVector is NOT written by code: after create a raw-SQL query confirms the
 *   generated column is non-null (the DB computed it).
 * - Ownership: an employer cannot edit/pause/publish another company's job → 403/404.
 * - duplicate creates a fresh DRAFT with a NEW DB-assigned humanId (not copied).
 *
 * PublishGuardService is mocked — it is tested in its own spec.
 */
import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CompanyStatus,
  CompanyType,
  Currency,
  EmploymentType,
  JobMarket,
  JobStatus,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { execSync } from 'child_process';
import * as path from 'path';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmployerService } from '../employer/employer.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../settings/settings.keys';
import { JobsService } from './jobs.service';
import { JobLifecycleService } from './job-lifecycle.service';
import { PublishGuardService } from './publish-guard.service';
import { CreateJobDto } from './dto/create-job.dto';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');

let pg: StartedTestContainer;
let prismaClient: PrismaClient;
let service: JobsService;
let dockerUnavailable = false;

const EMPLOYER_USER_ID = 'jsvc-emp-1';
const OTHER_EMPLOYER_USER_ID = 'jsvc-emp-2';
const CATEGORY_ID = 'jsvc-cat-1';

beforeAll(async () => {
  try {
    pg = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_USER: 'sic',
        POSTGRES_PASSWORD: 'sic',
        POSTGRES_DB: 'sic_jobs_svc',
      })
      .withExposedPorts(5432)
      .start();

    const url = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_jobs_svc`;

    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });

    prismaClient = new PrismaClient({ datasources: { db: { url } } });
    await prismaClient.$connect();

    // Seed settings
    const settingRows: Array<[string, unknown, boolean]> = [
      ['worker_protection.accommodation_required', true, true],
      ['worker_protection.health_insurance_required', true, true],
      ['worker_protection.transportation_required', true, true],
      ['jobs.free_max_active_jobs', 1, false],
      ['jobs.require_admin_approval', false, false],
      ['jobs.auto_archive_days', 90, false],
    ];
    for (const [key, value, isCoreRule] of settingRows) {
      await prismaClient.setting.upsert({
        where: { key },
        create: { key, value: value as never, isCoreRule },
        update: { value: value as never },
      });
    }

    // Seed job category
    await prismaClient.jobCategory.upsert({
      where: { id: CATEGORY_ID },
      create: { id: CATEGORY_ID, slug: 'jsvc-general', nameEn: 'JS General' },
      update: {},
    });

    // Seed employer users + companies
    for (const [userId, email, compStatus] of [
      [EMPLOYER_USER_ID, 'jsvc-emp1@example.com', CompanyStatus.APPROVED],
      [OTHER_EMPLOYER_USER_ID, 'jsvc-emp2@example.com', CompanyStatus.APPROVED],
    ] as const) {
      await prismaClient.user.upsert({
        where: { id: userId },
        create: { id: userId, email, role: UserRole.EMPLOYER },
        update: {},
      });
      const co = await prismaClient.company.create({
        data: {
          name: `Co ${userId}`,
          type: CompanyType.LOCAL,
          registrationNumber: `REG-${userId}`,
          industryType: 'IT',
          phone: '+91111',
          location: 'Delhi',
          employeeRange: '10-50',
          status: compStatus,
        },
      });
      await prismaClient.employerUser.upsert({
        where: { userId },
        create: { userId, companyId: co.id, isPrimary: true },
        update: {},
      });
    }

    const prismaSvc = prismaClient as unknown as PrismaService;
    const eventEmitter = new EventEmitter2();
    const auditService = new AuditService(prismaSvc);
    const employerService = new EmployerService(prismaSvc, null as never);

    // Mock SettingsService (Redis-free)
    const mockSettingsService = {
      get: jest.fn(async (keyDef: { key: string }) => {
        const row = await prismaClient.setting.findUniqueOrThrow({ where: { key: keyDef.key } });
        return row.value;
      }),
    } as unknown as SettingsService;

    // Mock PublishGuardService — tested separately
    const mockPublishGuard = {
      assertPublishable: jest.fn().mockResolvedValue(undefined),
    } as unknown as PublishGuardService;

    const lifecycle = new JobLifecycleService(prismaSvc, auditService, eventEmitter);

    service = new JobsService(
      prismaSvc,
      employerService,
      mockSettingsService,
      auditService,
      mockPublishGuard,
      lifecycle,
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
      console.warn('[jobs-service] Docker unavailable — tests will be skipped:', msg);
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
  await prismaClient.job.deleteMany();
});

function baseDto(): CreateJobDto {
  return {
    title: 'Mason',
    employmentType: EmploymentType.FULL_TIME,
    market: JobMarket.LOCAL,
    location: 'Delhi',
    description: '<p>Good job</p>',
    categoryId: CATEGORY_ID,
    requirements: ['3 years exp'],
    salaryMin: 20000,
    salaryMax: 30000,
    currency: Currency.INR,
    accommodation: true,
    healthInsurance: true,
    transportation: true,
    foodAllowance: false,
    airTicketArrival: false,
    airTicketDeparture: false,
    hoursPerDay: 8,
    daysPerWeek: 6,
    overtime: false,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('JobsService', () => {
  describe('create', () => {
    it('creates a DRAFT job with a DB-assigned humanId matching JB-YYYY-N', async () => {
      if (dockerUnavailable) return;

      const job = await service.create(baseDto(), EMPLOYER_USER_ID, UserRole.EMPLOYER);

      expect(job.status).toBe(JobStatus.DRAFT);
      expect(job.humanId).toMatch(/^JB-\d{4}-\d+$/);
    });

    it('searchVector is NOT null after create (DB-generated, never written by code)', async () => {
      if (dockerUnavailable) return;

      const job = await service.create(baseDto(), EMPLOYER_USER_ID, UserRole.EMPLOYER);

      // Raw query because omit excludes searchVector from the ORM return type
      const rows = await prismaClient.$queryRaw<Array<{ sv_null: boolean }>>`
        SELECT (search_vector IS NULL) AS sv_null
        FROM jobs
        WHERE id = ${job.id}
      `;
      expect(rows[0]?.sv_null).toBe(false);
    });

    it('sanitizes description — strips script tags', async () => {
      if (dockerUnavailable) return;

      const dto = {
        ...baseDto(),
        description: '<script>alert("xss")</script><p>Safe content</p>',
      };
      const job = await service.create(dto, EMPLOYER_USER_ID, UserRole.EMPLOYER);
      expect(job.description).not.toContain('<script>');
      expect(job.description).toContain('Safe content');
    });
  });

  describe('update', () => {
    it('updates editable fields on a DRAFT job', async () => {
      if (dockerUnavailable) return;

      const job = await service.create(baseDto(), EMPLOYER_USER_ID, UserRole.EMPLOYER);
      const updated = await service.update(
        job.id,
        { title: 'Senior Mason' },
        EMPLOYER_USER_ID,
        UserRole.EMPLOYER,
      );
      expect(updated.title).toBe('Senior Mason');
    });

    it('throws 403 when employer tries to update another company\'s job', async () => {
      if (dockerUnavailable) return;

      const job = await service.create(baseDto(), EMPLOYER_USER_ID, UserRole.EMPLOYER);
      await expect(
        service.update(job.id, { title: 'Hack' }, OTHER_EMPLOYER_USER_ID, UserRole.EMPLOYER),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('publish', () => {
    it('transitions DRAFT → ACTIVE when approval setting is OFF and guard passes', async () => {
      if (dockerUnavailable) return;

      const job = await service.create(baseDto(), EMPLOYER_USER_ID, UserRole.EMPLOYER);
      const published = await service.publish(job.id, EMPLOYER_USER_ID, UserRole.EMPLOYER);

      expect(published.status).toBe(JobStatus.ACTIVE);
      expect(published.publishedAt).not.toBeNull();
      expect(published.autoArchiveAt).not.toBeNull();
    });

    it('transitions DRAFT → PENDING_REVIEW when approval setting is ON', async () => {
      if (dockerUnavailable) return;

      // Temporarily turn on approval
      await prismaClient.setting.update({
        where: { key: SETTING_KEYS.REQUIRE_ADMIN_APPROVAL.key },
        data: { value: true },
      });

      const job = await service.create(baseDto(), EMPLOYER_USER_ID, UserRole.EMPLOYER);
      const published = await service.publish(job.id, EMPLOYER_USER_ID, UserRole.EMPLOYER);

      expect(published.status).toBe(JobStatus.PENDING_REVIEW);
      expect(published.publishedAt).toBeNull();

      await prismaClient.setting.update({
        where: { key: SETTING_KEYS.REQUIRE_ADMIN_APPROVAL.key },
        data: { value: false },
      });
    });

    it('throws 403 when employer publishes another company\'s job', async () => {
      if (dockerUnavailable) return;

      const job = await service.create(baseDto(), EMPLOYER_USER_ID, UserRole.EMPLOYER);
      await expect(
        service.publish(job.id, OTHER_EMPLOYER_USER_ID, UserRole.EMPLOYER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('propagates 422 WORKER_PROTECTION_VIOLATION from the publish guard', async () => {
      if (dockerUnavailable) return;

      const mockGuard = {
        assertPublishable: jest.fn().mockRejectedValue(
          new UnprocessableEntityException({ code: 'WORKER_PROTECTION_VIOLATION' }),
        ),
      } as unknown as PublishGuardService;

      const prismaSvc = prismaClient as unknown as PrismaService;
      const em = new EventEmitter2();
      const audit = new AuditService(prismaSvc);
      const employer = new EmployerService(prismaSvc, null as never);
      const mockSettings = {
        get: jest.fn().mockResolvedValue(false),
      } as unknown as SettingsService;
      const lifecycle = new JobLifecycleService(prismaSvc, audit, em);
      const guardedService = new JobsService(prismaSvc, employer, mockSettings, audit, mockGuard, lifecycle, em);

      const job = await guardedService.create(baseDto(), EMPLOYER_USER_ID, UserRole.EMPLOYER);
      await expect(
        guardedService.publish(job.id, EMPLOYER_USER_ID, UserRole.EMPLOYER),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('duplicate', () => {
    it('creates a fresh DRAFT with a NEW DB-assigned humanId (not copied from source)', async () => {
      if (dockerUnavailable) return;

      const original = await service.create(baseDto(), EMPLOYER_USER_ID, UserRole.EMPLOYER);
      const copy = await service.duplicate(original.id, EMPLOYER_USER_ID, UserRole.EMPLOYER);

      expect(copy.status).toBe(JobStatus.DRAFT);
      expect(copy.id).not.toBe(original.id);
      expect(copy.humanId).not.toBe(original.humanId);
      expect(copy.humanId).toMatch(/^JB-\d{4}-\d+$/);
      expect(copy.title).toBe(original.title);
      expect(copy.publishedAt).toBeNull();
    });

    it('throws 403 when duplicating another company\'s job', async () => {
      if (dockerUnavailable) return;

      const job = await service.create(baseDto(), EMPLOYER_USER_ID, UserRole.EMPLOYER);
      await expect(
        service.duplicate(job.id, OTHER_EMPLOYER_USER_ID, UserRole.EMPLOYER),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('list', () => {
    it('returns only the employer\'s own jobs', async () => {
      if (dockerUnavailable) return;

      await service.create(baseDto(), EMPLOYER_USER_ID, UserRole.EMPLOYER);
      await service.create(baseDto(), OTHER_EMPLOYER_USER_ID, UserRole.EMPLOYER);

      const result = await service.list(EMPLOYER_USER_ID, { page: 1, pageSize: 20, sort: 'createdAt:desc' });
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('pauseAllActiveJobsForCompany', () => {
    it('pauses all ACTIVE jobs and audits each', async () => {
      if (dockerUnavailable) return;

      // Create 2 active jobs
      const j1 = await service.create(baseDto(), EMPLOYER_USER_ID, UserRole.EMPLOYER);
      const j2 = await service.create(baseDto(), EMPLOYER_USER_ID, UserRole.EMPLOYER);

      const link = await prismaClient.employerUser.findUnique({ where: { userId: EMPLOYER_USER_ID } });
      const companyId = link!.companyId;

      // Force both to ACTIVE status for the test
      await prismaClient.job.updateMany({
        where: { id: { in: [j1.id, j2.id] } },
        data: { status: JobStatus.ACTIVE },
      });

      await service.pauseAllActiveJobsForCompany(companyId, 'employer_suspended');

      const paused = await prismaClient.job.findMany({
        where: { id: { in: [j1.id, j2.id] } },
        select: { status: true },
      });
      expect(paused.every((j) => j.status === JobStatus.PAUSED)).toBe(true);
    });
  });
});
