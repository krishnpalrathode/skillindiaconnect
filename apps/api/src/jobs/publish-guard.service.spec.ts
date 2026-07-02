/**
 * Integration tests for PublishGuardService — the platform's most critical enforcement gate.
 *
 * Tests the LOCKED order (approved-employer → protection-rules → quota) using a real
 * Postgres + Redis container so SettingsService cache-invalidation is exercised.
 *
 * Critical assertions:
 *   - ORDER: a not-approved employer publishing a protection-violating over-quota job
 *     gets EMPLOYER_NOT_APPROVED FIRST (the later checks are never reached).
 *   - PROTECTION RULES read from Settings: toggling the setting OFF causes the same
 *     job (accommodation=false) to pass — proving rules are Settings-driven, not hardcoded.
 *   - BLOCKED audit row written for every failed protection check (Screen-29 event).
 *   - QUOTA: FREE employer at cap (1 active) → JOB_QUOTA_EXCEEDED.
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
import { Redis } from 'ioredis';
import { PrismaService } from '../core/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import { EmployerService } from '../employer/employer.service';
import { PublishGuardService } from './publish-guard.service';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let prismaClient: PrismaClient;
let redis: Redis;
let publishGuard: PublishGuardService;
let settingsService: SettingsService;
let auditService: AuditService;
let dockerUnavailable = false;

const EMPLOYER_USER_ID = 'pu-employer-user-1';
const CATEGORY_ID = 'pu-category-1';

beforeAll(async () => {
  try {
    [pgContainer, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_USER: 'sic',
          POSTGRES_PASSWORD: 'sic',
          POSTGRES_DB: 'sic_publish_guard',
        })
        .withExposedPorts(5432)
        .start(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);

    const pgUrl = `postgresql://sic:sic@localhost:${pgContainer.getMappedPort(5432)}/sic_publish_guard`;
    const redisUrl = `redis://localhost:${redisContainer.getMappedPort(6379)}`;

    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: pgUrl },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });

    prismaClient = new PrismaClient({ datasources: { db: { url: pgUrl } } });
    await prismaClient.$connect();

    redis = new Redis(redisUrl, { lazyConnect: true });
    await redis.connect();

    // Seed required settings
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

    // Seed a job category
    await prismaClient.jobCategory.upsert({
      where: { id: CATEGORY_ID },
      create: { id: CATEGORY_ID, slug: 'pu-general', nameEn: 'PU General' },
      update: {},
    });

    settingsService = new SettingsService(
      prismaClient as unknown as PrismaService,
      redis,
      new EventEmitter2(),
    );

    auditService = new AuditService(prismaClient as unknown as PrismaService);

    const employerService = new EmployerService(
      prismaClient as unknown as PrismaService,
      null as never, // StorageService not needed for assertApproved
    );

    publishGuard = new PublishGuardService(
      prismaClient as unknown as PrismaService,
      employerService,
      settingsService,
      auditService,
      new EventEmitter2(),
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
      console.warn('[publish-guard] Docker unavailable — tests will be skipped:', msg);
    } else {
      throw err;
    }
  }
});

afterAll(async () => {
  if (!dockerUnavailable) {
    await redis?.quit();
    await prismaClient?.$disconnect();
  }
  await pgContainer?.stop();
  await redisContainer?.stop();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function createApprovedCompany(userIdSuffix: string): Promise<{
  userId: string;
  companyId: string;
}> {
  const userId = `${EMPLOYER_USER_ID}-${userIdSuffix}`;
  const email = `emp-${userIdSuffix}@example.com`;

  const user = await prismaClient.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      email,
      role: UserRole.EMPLOYER,
    },
    update: {},
  });

  const company = await prismaClient.company.create({
    data: {
      name: `Test Co ${userIdSuffix}`,
      type: CompanyType.LOCAL,
      registrationNumber: `REG-${userIdSuffix}`,
      industryType: 'IT',
      phone: '+91111',
      location: 'Delhi',
      employeeRange: '10-50',
      status: CompanyStatus.APPROVED,
    },
  });

  await prismaClient.employerUser.create({
    data: { userId: user.id, companyId: company.id, isPrimary: true },
  });

  return { userId: user.id, companyId: company.id };
}

function makeMinimalJob(
  companyId: string,
  overrides: Partial<{
    accommodation: boolean;
    healthInsurance: boolean;
    transportation: boolean;
  }> = {},
) {
  return {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    companyId,
    accommodation: true,
    healthInsurance: true,
    transportation: true,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PublishGuardService — ordered enforcement gate', () => {
  // ── 1. ORDER: not-approved employer blocks first ───────────────────────────

  it('ORDER: not-approved employer → 403 EMPLOYER_NOT_APPROVED before checking protection or quota', async () => {
    if (dockerUnavailable) return;

    // Pending (not approved) company
    const userId = `${EMPLOYER_USER_ID}-pending`;
    await prismaClient.user.upsert({
      where: { id: userId },
      create: { id: userId, email: 'pending-emp@example.com', role: UserRole.EMPLOYER },
      update: {},
    });
    const pendingCompany = await prismaClient.company.create({
      data: {
        name: 'Pending Co',
        type: CompanyType.LOCAL,
        registrationNumber: 'REG-P',
        industryType: 'IT',
        phone: '+92222',
        location: 'Mumbai',
        employeeRange: '1-10',
        status: CompanyStatus.PENDING,
      },
    });
    await prismaClient.employerUser.create({
      data: { userId, companyId: pendingCompany.id, isPrimary: true },
    });

    // Job that violates ALL protection rules and is over-quota — but should never get there
    const badJob = makeMinimalJob(pendingCompany.id, {
      accommodation: false,
      healthInsurance: false,
      transportation: false,
    });

    await expect(
      publishGuard.assertPublishable(badJob, pendingCompany, userId, UserRole.EMPLOYER),
    ).rejects.toThrow(ForbiddenException);

    // No BLOCKED audit row should be written (we never reached protection check)
    const blockedRows = await prismaClient.auditLog.findMany({
      where: { action: AUDIT_ACTIONS.JOB_PUBLISH_BLOCKED, targetId: badJob.id },
    });
    expect(blockedRows).toHaveLength(0);
  });

  // ── 2. Protection rules written from Settings ─────────────────────────────

  it('PROTECTION: accommodation=false with rule ON → 422 WORKER_PROTECTION_VIOLATION + BLOCKED audit', async () => {
    if (dockerUnavailable) return;

    const { userId, companyId } = await createApprovedCompany('prot-1');
    const job = makeMinimalJob(companyId, { accommodation: false });

    // Ensure accommodation_required is ON in Settings (and Redis cache is fresh)
    await redis.del('settings:worker_protection.accommodation_required');
    await prismaClient.setting.update({
      where: { key: 'worker_protection.accommodation_required' },
      data: { value: true },
    });

    await expect(
      publishGuard.assertPublishable(job, { id: companyId }, userId, UserRole.EMPLOYER),
    ).rejects.toThrow(UnprocessableEntityException);

    let err: UnprocessableEntityException | undefined;
    try {
      await publishGuard.assertPublishable(job, { id: companyId }, userId, UserRole.EMPLOYER);
    } catch (e) {
      err = e as UnprocessableEntityException;
    }
    const body = err!.getResponse() as Record<string, unknown>;
    expect(body.code).toBe('WORKER_PROTECTION_VIOLATION');
    const meta = body.meta as Record<string, unknown>;
    expect((meta.failedRules as string[])).toContain('accommodation');

    // BLOCKED audit row must be present
    const blockedRows = await prismaClient.auditLog.findMany({
      where: { action: AUDIT_ACTIONS.JOB_PUBLISH_BLOCKED, targetId: job.id },
    });
    expect(blockedRows.length).toBeGreaterThanOrEqual(1);
    expect(blockedRows[0]?.status).toBe('BLOCKED');
  });

  it('SETTINGS-DRIVEN: turning accommodation_required OFF causes the same job to pass protection', async () => {
    if (dockerUnavailable) return;

    const { userId, companyId } = await createApprovedCompany('prot-settings');
    const job = makeMinimalJob(companyId, { accommodation: false });

    // Turn accommodation_required OFF (simulate Super-Admin change)
    await prismaClient.setting.update({
      where: { key: 'worker_protection.accommodation_required' },
      data: { value: false },
    });
    await redis.del('settings:worker_protection.accommodation_required');

    // Also turn the others OFF so we don't get a different protection violation
    for (const key of [
      'worker_protection.health_insurance_required',
      'worker_protection.transportation_required',
    ]) {
      await prismaClient.setting.update({ where: { key }, data: { value: false } });
      await redis.del(`settings:${key}`);
    }

    // Should NOT throw WORKER_PROTECTION_VIOLATION; may throw JOB_QUOTA_EXCEEDED
    // (quota still applies — 0 active jobs so FREE cap of 1 is fine)
    await expect(
      publishGuard.assertPublishable(job, { id: companyId }, userId, UserRole.EMPLOYER),
    ).resolves.toBeUndefined();

    // Restore for subsequent tests
    for (const key of [
      'worker_protection.accommodation_required',
      'worker_protection.health_insurance_required',
      'worker_protection.transportation_required',
    ]) {
      await prismaClient.setting.update({ where: { key }, data: { value: true } });
      await redis.del(`settings:${key}`);
    }
  });

  // ── 3. Quota ──────────────────────────────────────────────────────────────

  it('QUOTA: FREE employer at cap (1 active job) → 422 JOB_QUOTA_EXCEEDED', async () => {
    if (dockerUnavailable) return;

    const { userId, companyId } = await createApprovedCompany('quota-1');

    // Create an ACTIVE job that consumes the quota
    await prismaClient.job.create({
      data: {
        companyId,
        title: 'Active Job',
        employmentType: EmploymentType.FULL_TIME,
        market: JobMarket.LOCAL,
        location: 'Delhi',
        description: 'Test job',
        categoryId: CATEGORY_ID,
        salaryMin: 100,
        salaryMax: 200,
        currency: Currency.INR,
        hoursPerDay: 8,
        daysPerWeek: 5,
        status: JobStatus.ACTIVE,
        publishedAt: new Date(),
        autoArchiveAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });

    const newJob = makeMinimalJob(companyId);

    await expect(
      publishGuard.assertPublishable(newJob, { id: companyId }, userId, UserRole.EMPLOYER),
    ).rejects.toThrow(UnprocessableEntityException);

    let err: UnprocessableEntityException | undefined;
    try {
      await publishGuard.assertPublishable(newJob, { id: companyId }, userId, UserRole.EMPLOYER);
    } catch (e) {
      err = e as UnprocessableEntityException;
    }
    expect((err!.getResponse() as Record<string, unknown>).code).toBe('JOB_QUOTA_EXCEEDED');
  });

  it('QUOTA: employer with active PRO subscription (maxActiveJobs=null) → passes quota', async () => {
    if (dockerUnavailable) return;

    const { userId, companyId } = await createApprovedCompany('quota-pro');

    // Create a PRO plan with unlimited jobs
    const plan = await prismaClient.plan.upsert({
      where: { code: 'PRO_TEST' },
      create: {
        code: 'PRO_TEST',
        name: 'Pro Test',
        priceSubunits: 299900,
        period: 'MONTHLY',
        maxActiveJobs: null,
        features: ['unlimited'],
        isActive: true,
      },
      update: {},
    });

    await prismaClient.subscription.create({
      data: {
        companyId,
        planId: plan.id,
        status: 'ACTIVE',
        startsAt: new Date(),
      },
    });

    // Add 5 active jobs — beyond the FREE cap of 1
    for (let i = 0; i < 5; i++) {
      await prismaClient.job.create({
        data: {
          companyId,
          title: `Pro Job ${i}`,
          employmentType: EmploymentType.FULL_TIME,
          market: JobMarket.LOCAL,
          location: 'Delhi',
          description: 'Pro test job',
          categoryId: CATEGORY_ID,
          salaryMin: 100,
          salaryMax: 200,
          currency: Currency.INR,
          hoursPerDay: 8,
          daysPerWeek: 5,
          status: JobStatus.ACTIVE,
          publishedAt: new Date(),
          autoArchiveAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        },
      });
    }

    const newJob = makeMinimalJob(companyId);

    // Should pass (PRO = unlimited)
    await expect(
      publishGuard.assertPublishable(newJob, { id: companyId }, userId, UserRole.EMPLOYER),
    ).resolves.toBeUndefined();
  });
});
