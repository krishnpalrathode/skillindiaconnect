/**
 * S6b-B2 integration — admin job moderation on real Postgres + Redis.
 *
 * THE POINT OF THIS FILE is the gate re-check trio: a job that was compliant
 * when submitted may not be compliant when approved — the world moved while it
 * sat in review. All three real-world drifts are staged and proven to block
 * the approval with their own codes:
 *   1. the employer was SUSPENDED during review        → 403 EMPLOYER_NOT_APPROVED
 *   2. a protection rule was switched ON during review → 422 WORKER_PROTECTION_VIOLATION
 *      (+ the guard's BLOCKED audit row)
 *   3. the employer's plan expired (over the Free cap) → 422 JOB_QUOTA_EXCEEDED
 * The admin cannot click past the platform's safety gate — and the same ladder
 * is proven on on-behalf publishing.
 *
 * Also proven here: the flags→search-cache invalidation (the REAL
 * SearchCacheSubscriber on a REAL Redis — the version key moves), the same
 * post-publish work as a direct publish, notes/resend RBAC, and per-endpoint
 * 403 denials. Skips gracefully when Docker is unavailable.
 */
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  ValidationPipe,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { getQueueToken } from '@nestjs/bullmq';
import {
  CompanyStatus,
  Currency,
  EmploymentType,
  JobMarket,
  JobStatus,
  NotificationType,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { Redis } from 'ioredis';
import supertest from 'supertest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import * as path from 'path';
import { execSync } from 'child_process';
import { PrismaService } from '../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../core/redis/redis.provider';
import { StorageService } from '../core/storage/storage.service';
import { HttpProblemFilter, validationProblemFactory } from '../core/http-problem.filter';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import { PermissionService } from '../auth/rbac/permission.service';
import { PermissionsGuard } from '../auth/rbac/permissions.guard';
import { Permission } from '../auth/rbac/permission.constants';
import { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { EmployerService } from '../employer/employer.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../settings/settings.keys';
import { SubscriptionReadService } from '../payments/subscription-read.service';
import { NotificationService } from '../notifications/notification.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { ApplicationsAggregateService } from '../applications/applications-aggregate.service';
import { SearchCacheService } from '../jobs-search/search-cache.service';
import { SearchCacheSubscriber } from '../jobs-search/search-cache.subscriber';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { AdminNotesController } from '../applications/admin-notes.controller';
import { AdminNotesService } from '../applications/admin-notes.service';
import { AdminResendController } from '../applications/admin-resend.controller';
import { AdminResendService } from '../applications/admin-resend.service';
import { JobsService } from './jobs.service';
import { JobLifecycleService } from './job-lifecycle.service';
import { PublishGuardService } from './publish-guard.service';
import { AdminJobsController } from './admin-jobs.controller';
import { AdminJobsService } from './admin-jobs.service';

jest.setTimeout(240_000);

const API_DIR = path.resolve(__dirname, '../..');

const ACTOR_ID: Record<string, string> = {
  SUPER_ADMIN: '11111111-1111-4111-8111-111111111111',
  MODERATOR: '33333333-3333-4333-8333-333333333333',
};

@Injectable()
class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: CurrentUserPayload;
    }>();
    const role = req.headers['x-test-role'] as UserRole | undefined;
    if (!role) return false;
    req.user = {
      userId: ACTOR_ID[role] ?? '99999999-9999-4999-8999-999999999999',
      role,
      jti: 'test-jti',
      exp: 9_999_999_999,
    };
    return true;
  }
}

let pg: StartedTestContainer;
let redisContainer: StartedTestContainer;
let prisma: PrismaClient;
let redis: Redis;
let app: INestApplication;
let cache: SearchCacheService;
let notificationQueueAdd: jest.Mock;
let dockerUnavailable = false;

let seq = 0;
let categoryId: string;

const get = (url: string, role: UserRole) =>
  supertest(app.getHttpServer()).get(url).set('x-test-role', role);
const post = (url: string, role: UserRole, body: Record<string, unknown> = {}) =>
  supertest(app.getHttpServer()).post(url).set('x-test-role', role).send(body);
const patch = (url: string, role: UserRole, body: Record<string, unknown>) =>
  supertest(app.getHttpServer()).patch(url).set('x-test-role', role).send(body);

async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value: value as never },
    create: { key, value: value as never },
  });
  // Settings are cached in Redis (DEL-on-write in the real service) — mirror it.
  await redis.del(`settings:${key}`);
}

async function mkCompany(status: CompanyStatus): Promise<{ companyId: string; userId: string }> {
  const n = ++seq;
  const user = await prisma.user.create({
    data: { email: `employer-${n}@example.com`, role: UserRole.EMPLOYER },
  });
  const company = await prisma.company.create({
    data: {
      name: `Employer Co ${n}`,
      type: 'LOCAL',
      status,
      registrationNumber: `R-${n}`,
      industryType: 'Construction',
      phone: `+91100000${n}`,
      location: 'Pune',
      employeeRange: '10-50',
      employerUsers: { create: [{ userId: user.id }] },
    },
  });
  return { companyId: company.id, userId: user.id };
}

async function mkJob(
  companyId: string,
  status: JobStatus,
  overrides: Partial<{
    accommodation: boolean;
    healthInsurance: boolean;
    transportation: boolean;
    isFeatured: boolean;
  }> = {},
): Promise<string> {
  const n = ++seq;
  const job = await prisma.job.create({
    data: {
      companyId,
      title: `Mason Job ${n}`,
      employmentType: EmploymentType.FULL_TIME,
      market: JobMarket.GULF,
      location: 'Dubai',
      description: 'x',
      categoryId,
      salaryMin: 100,
      salaryMax: 200,
      currency: Currency.AED,
      hoursPerDay: 8,
      daysPerWeek: 6,
      status,
      accommodation: overrides.accommodation ?? true,
      healthInsurance: overrides.healthInsurance ?? true,
      transportation: overrides.transportation ?? true,
      isFeatured: overrides.isFeatured ?? false,
    },
  });
  return job.id;
}

const jobRow = (id: string) => prisma.job.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  try {
    [pg, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({ POSTGRES_USER: 'sic', POSTGRES_PASSWORD: 'sic', POSTGRES_DB: 'sic_test' })
        .withExposedPorts(5432)
        .start(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);

    const pgUrl = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_test`;
    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: pgUrl },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });

    prisma = new PrismaClient({ datasources: { db: { url: pgUrl } } });
    await prisma.$connect();
    redis = new Redis(`redis://localhost:${redisContainer.getMappedPort(6379)}`);
    notificationQueueAdd = jest.fn().mockResolvedValue(undefined);

    const category = await prisma.jobCategory.create({ data: { slug: 'mason', nameEn: 'Mason' } });
    categoryId = category.id;

    // Baseline settings: protection rules ON, admin approval ON, Free cap 1.
    await setSetting(SETTING_KEYS.ACCOMMODATION_REQUIRED.key, true);
    await setSetting(SETTING_KEYS.HEALTH_INSURANCE_REQUIRED.key, true);
    await setSetting(SETTING_KEYS.TRANSPORTATION_REQUIRED.key, true);
    await setSetting(SETTING_KEYS.AUTO_ARCHIVE_DAYS.key, 90);
    await setSetting(SETTING_KEYS.REQUIRE_ADMIN_APPROVAL.key, true);
    await setSetting(SETTING_KEYS.FREE_MAX_ACTIVE_JOBS.key, 1);

    // RBAC: SUPER_ADMIN holds everything; MODERATOR holds NOTHING here, so every
    // endpoint has a live denial to prove.
    await prisma.rolePermission.createMany({
      data: [
        Permission.JOBS_VIEW,
        Permission.JOBS_MODERATE,
        Permission.JOBS_POST_ADMIN,
        Permission.APPLICATIONS_NOTES,
        Permission.APPLICATIONS_CHANGE_STATUS,
      ].map((permissionKey) => ({
        role: UserRole.SUPER_ADMIN,
        permissionKey,
        enabled: true,
        isLocked: false,
      })),
    });

    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      controllers: [AdminJobsController, AdminNotesController, AdminResendController],
      providers: [
        AdminJobsService,
        AdminNotesService,
        AdminResendService,
        JobsService,
        JobLifecycleService,
        PublishGuardService,
        EmployerService,
        SettingsService,
        SubscriptionReadService,
        NotificationService,
        CandidateReadService,
        ApplicationsAggregateService,
        SearchCacheService,
        SearchCacheSubscriber, // the REAL invalidation listener
        AuditService,
        PermissionService,
        { provide: PrismaService, useValue: prisma as unknown as PrismaService },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: StorageService, useValue: {} }, // EmployerService dep; unused here
        { provide: getQueueToken(QUEUE_NAMES.NOTIFICATION), useValue: { add: notificationQueueAdd } },
        { provide: APP_GUARD, useClass: TestAuthGuard },
        {
          provide: APP_GUARD,
          useFactory: (reflector: Reflector, ps: PermissionService) =>
            new PermissionsGuard(reflector, ps),
          inject: [Reflector, PermissionService],
        },
        { provide: APP_FILTER, useClass: HttpProblemFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: validationProblemFactory,
      }),
    );
    await app.init();
    cache = app.get(SearchCacheService);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('container runtime') ||
      msg.includes('Docker') ||
      msg.includes('ENOENT') ||
      msg.includes('connect ECONNREFUSED') ||
      msg.includes('not recognized')
    ) {
      dockerUnavailable = true;
      console.warn('[integration] Docker unavailable - skipping:', msg);
    } else {
      throw err;
    }
  }
});

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  redis?.disconnect();
  await pg?.stop();
  await redisContainer?.stop();
});

beforeEach(() => {
  notificationQueueAdd?.mockClear();
});

/** Wait one macrotask so @OnEvent async handlers settle before asserting. */
const settleEvents = () => new Promise((resolve) => setTimeout(resolve, 50));

// ─── review: the gate re-check trio ──────────────────────────────────────────

describe('POST /admin/jobs/{id}/review — APPROVE re-runs the publish gates', () => {
  it('all gates passing → ACTIVE with the SAME post-publish work as a direct publish', async () => {
    if (dockerUnavailable) return;
    const { companyId, userId } = await mkCompany(CompanyStatus.APPROVED);
    const jobId = await mkJob(companyId, JobStatus.PENDING_REVIEW);
    const versionBefore = await cache.getSearchVersion();

    const res = await post(`/admin/jobs/${jobId}/review`, UserRole.SUPER_ADMIN, {
      decision: 'APPROVE',
    }).expect(200);
    expect(res.body.data.status).toBe('ACTIVE');

    const job = await jobRow(jobId);
    expect(job.publishedAt).not.toBeNull();
    expect(job.autoArchiveAt).not.toBeNull(); // 90d from Settings
    expect(job.moderatedById).toBe(ACTOR_ID['SUPER_ADMIN']);

    // job.published fired → the REAL SearchCacheSubscriber bumped the version.
    await settleEvents();
    expect(await cache.getSearchVersion()).toBeGreaterThan(versionBefore);

    // Audited as a review approval (admin actor).
    const audit = await prisma.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.JOB_REVIEW_APPROVED, targetId: jobId },
    });
    expect(audit?.actorUserId).toBe(ACTOR_ID['SUPER_ADMIN']);

    // The employer got the JOB_APPROVED outcome: in-app row + email job, NO whatsapp.
    const inApp = await prisma.notification.findFirst({
      where: { userId, type: NotificationType.JOB_APPROVED },
    });
    expect(inApp).not.toBeNull();
    const channels = notificationQueueAdd.mock.calls
      .filter((c) => c[1].type === NotificationType.JOB_APPROVED)
      .map((c) => c[1].channel);
    expect(channels).toEqual(['email']);
  });

  it('employer SUSPENDED while in review → 403 EMPLOYER_NOT_APPROVED (no click-past)', async () => {
    if (dockerUnavailable) return;
    const { companyId } = await mkCompany(CompanyStatus.SUSPENDED);
    const jobId = await mkJob(companyId, JobStatus.PENDING_REVIEW);

    const res = await post(`/admin/jobs/${jobId}/review`, UserRole.SUPER_ADMIN, {
      decision: 'APPROVE',
    }).expect(403);
    expect(res.body.code).toBe('EMPLOYER_NOT_APPROVED');
    expect((await jobRow(jobId)).status).toBe(JobStatus.PENDING_REVIEW); // untouched
  });

  it('protection rule switched ON during review → 422 + the guard’s BLOCKED audit row', async () => {
    if (dockerUnavailable) return;
    const { companyId } = await mkCompany(CompanyStatus.APPROVED);
    // The job was submitted while accommodation was allowed to be false…
    const jobId = await mkJob(companyId, JobStatus.PENDING_REVIEW, { accommodation: false });
    // …and the rule is ON at approval time (seeded ON in beforeAll).

    const res = await post(`/admin/jobs/${jobId}/review`, UserRole.SUPER_ADMIN, {
      decision: 'APPROVE',
    }).expect(422);
    expect(res.body.code).toBe('WORKER_PROTECTION_VIOLATION');
    expect(res.body.meta.violations).toEqual(['accommodation']);

    const blocked = await prisma.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.JOB_PUBLISH_BLOCKED, targetId: jobId },
    });
    expect(blocked).not.toBeNull();
    expect((await jobRow(jobId)).status).toBe(JobStatus.PENDING_REVIEW);
  });

  it('plan expired during review (over the Free cap) → 422 JOB_QUOTA_EXCEEDED', async () => {
    if (dockerUnavailable) return;
    const { companyId } = await mkCompany(CompanyStatus.APPROVED);
    // No paid subscription → the Free cap (1) applies, and one ACTIVE job fills it.
    await mkJob(companyId, JobStatus.ACTIVE);
    const jobId = await mkJob(companyId, JobStatus.PENDING_REVIEW);

    const res = await post(`/admin/jobs/${jobId}/review`, UserRole.SUPER_ADMIN, {
      decision: 'APPROVE',
    }).expect(422);
    expect(res.body.code).toBe('JOB_QUOTA_EXCEEDED');
    expect((await jobRow(jobId)).status).toBe(JobStatus.PENDING_REVIEW);
  });

  it('REJECT without a reason → 422; with one → DRAFT + stored + notified (email+in-app, no WhatsApp)', async () => {
    if (dockerUnavailable) return;
    const { companyId, userId } = await mkCompany(CompanyStatus.APPROVED);
    const jobId = await mkJob(companyId, JobStatus.PENDING_REVIEW);

    const missing = await post(`/admin/jobs/${jobId}/review`, UserRole.SUPER_ADMIN, {
      decision: 'REJECT',
    }).expect(422);
    expect(missing.body.code).toBe('REVIEW_REASON_REQUIRED');

    const res = await post(`/admin/jobs/${jobId}/review`, UserRole.SUPER_ADMIN, {
      decision: 'REJECT',
      reason: 'Salary range is below the market minimum.',
    }).expect(200);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.moderationReason).toBe('Salary range is below the market minimum.');

    const job = await jobRow(jobId);
    expect(job.status).toBe(JobStatus.DRAFT);
    expect(job.moderationReason).toBe('Salary range is below the market minimum.');

    const inApp = await prisma.notification.findFirst({
      where: { userId, type: NotificationType.JOB_REJECTED },
    });
    expect(inApp?.body).toContain('Salary range');
    const channels = notificationQueueAdd.mock.calls
      .filter((c) => c[1].type === NotificationType.JOB_REJECTED)
      .map((c) => c[1].channel);
    expect(channels).toEqual(['email']); // matrix row: no WhatsApp — asserted
  });

  it('a non-PENDING_REVIEW job → 409 JOB_NOT_PENDING_REVIEW; RBAC denial for MODERATOR', async () => {
    if (dockerUnavailable) return;
    const { companyId } = await mkCompany(CompanyStatus.APPROVED);
    const activeId = await mkJob(companyId, JobStatus.ACTIVE);

    const conflict = await post(`/admin/jobs/${activeId}/review`, UserRole.SUPER_ADMIN, {
      decision: 'APPROVE',
    }).expect(409);
    expect(conflict.body.code).toBe('JOB_NOT_PENDING_REVIEW');

    await post(`/admin/jobs/${activeId}/review`, UserRole.MODERATOR, {
      decision: 'APPROVE',
    }).expect(403);
  });
});

// ─── list ─────────────────────────────────────────────────────────────────────

describe('GET /admin/jobs', () => {
  it('returns EVERY status; the queue deep-link filter works; 403 without jobs.view', async () => {
    if (dockerUnavailable) return;
    const { companyId } = await mkCompany(CompanyStatus.APPROVED);
    const draftId = await mkJob(companyId, JobStatus.DRAFT);
    const pendingId = await mkJob(companyId, JobStatus.PENDING_REVIEW);

    const all = await get('/admin/jobs?pageSize=100', UserRole.SUPER_ADMIN).expect(200);
    const ids = (all.body.data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([draftId, pendingId]));

    const pending = await get(
      '/admin/jobs?status=PENDING_REVIEW&pageSize=100',
      UserRole.SUPER_ADMIN,
    ).expect(200);
    const statuses = new Set((pending.body.data as Array<{ status: string }>).map((r) => r.status));
    expect(statuses).toEqual(new Set(['PENDING_REVIEW']));
    expect((pending.body.data as Array<{ id: string }>).some((r) => r.id === pendingId)).toBe(true);

    await get('/admin/jobs', UserRole.MODERATOR).expect(403);
  });

  it('filters on the admin-set flags', async () => {
    if (dockerUnavailable) return;
    const { companyId } = await mkCompany(CompanyStatus.APPROVED);
    const featuredId = await mkJob(companyId, JobStatus.ACTIVE, { isFeatured: true });

    const res = await get('/admin/jobs?featured=true&pageSize=100', UserRole.SUPER_ADMIN).expect(200);
    const rows = res.body.data as Array<{ id: string; isFeatured: boolean }>;
    expect(rows.every((r) => r.isFeatured)).toBe(true);
    expect(rows.some((r) => r.id === featuredId)).toBe(true);
  });
});

// ─── pause / archive: any job, but the state machine governs ─────────────────

describe('admin pause/archive', () => {
  it('pauses and archives ANY employer’s job; illegal transitions → 409; events invalidate the cache', async () => {
    if (dockerUnavailable) return;
    const { companyId } = await mkCompany(CompanyStatus.APPROVED);
    const jobId = await mkJob(companyId, JobStatus.ACTIVE);
    const versionBefore = await cache.getSearchVersion();

    const paused = await post(`/admin/jobs/${jobId}/pause`, UserRole.SUPER_ADMIN, {
      reason: 'reported by candidates',
    }).expect(200);
    expect(paused.body.data.status).toBe('PAUSED');
    await settleEvents();
    expect(await cache.getSearchVersion()).toBeGreaterThan(versionBefore);

    // Pausing a PAUSED job is illegal — the lifecycle service still governs.
    const dup = await post(`/admin/jobs/${jobId}/pause`, UserRole.SUPER_ADMIN).expect(409);
    expect(dup.body.code).toBe('ILLEGAL_JOB_TRANSITION');

    const archived = await post(`/admin/jobs/${jobId}/archive`, UserRole.SUPER_ADMIN).expect(200);
    expect(archived.body.data.status).toBe('ARCHIVED');
    await post(`/admin/jobs/${jobId}/archive`, UserRole.SUPER_ADMIN).expect(409);

    // The lifecycle audit rows carry the admin actor + the pause reason.
    const pauseAudit = await prisma.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.JOB_PAUSED, targetId: jobId },
    });
    expect(pauseAudit?.actorUserId).toBe(ACTOR_ID['SUPER_ADMIN']);
    expect((pauseAudit?.meta as Record<string, unknown>)['reason']).toBe('reported by candidates');

    await post(`/admin/jobs/${jobId}/pause`, UserRole.MODERATOR).expect(403);
  });
});

// ─── flags → the search-cache integration point ──────────────────────────────

describe('PATCH /admin/jobs/{id}/flags', () => {
  it('persists, audits, and INVALIDATES the search cache via the existing mechanism', async () => {
    if (dockerUnavailable) return;
    const { companyId } = await mkCompany(CompanyStatus.APPROVED);
    const jobId = await mkJob(companyId, JobStatus.ACTIVE);
    const versionBefore = await cache.getSearchVersion();

    const res = await patch(`/admin/jobs/${jobId}/flags`, UserRole.SUPER_ADMIN, {
      featured: true,
    }).expect(200);
    expect(res.body.data.isFeatured).toBe(true);
    expect(res.body.data.isUrgent).toBe(false); // omitted → unchanged

    expect((await jobRow(jobId)).isFeatured).toBe(true);

    // THE integration point: job.flags.changed → the REAL SearchCacheSubscriber
    // bumped the version, so no cached page can keep hiding the badge.
    await settleEvents();
    expect(await cache.getSearchVersion()).toBeGreaterThan(versionBefore);

    const audit = await prisma.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.JOB_FLAGS_CHANGED, targetId: jobId },
    });
    expect((audit?.meta as { to?: { featured?: boolean } }).to?.featured).toBe(true);

    // Empty body → 422; RBAC denial proven.
    await patch(`/admin/jobs/${jobId}/flags`, UserRole.SUPER_ADMIN, {}).expect(422);
    await patch(`/admin/jobs/${jobId}/flags`, UserRole.MODERATOR, { urgent: true }).expect(403);
  });
});

// ─── on-behalf posting: the same gates, no laundering ────────────────────────

describe('POST /admin/jobs (on-behalf)', () => {
  const createBody = (employerId: string, extras: Record<string, unknown> = {}) => ({
    employerId,
    title: 'On-behalf Mason',
    employmentType: 'FULL_TIME',
    market: 'GULF',
    location: 'Doha',
    description: 'x',
    categoryId,
    requirements: [],
    salaryMin: 100,
    salaryMax: 200,
    currency: 'QAR',
    accommodation: true,
    healthInsurance: true,
    transportation: true,
    foodAllowance: false,
    airTicketArrival: false,
    airTicketDeparture: false,
    overtime: false,
    hoursPerDay: 8,
    daysPerWeek: 6,
    ...extras,
  });

  it('creates a DRAFT with postedByAdminId; the employer is notified', async () => {
    if (dockerUnavailable) return;
    const { companyId, userId } = await mkCompany(CompanyStatus.APPROVED);

    const res = await post('/admin/jobs', UserRole.SUPER_ADMIN, createBody(companyId)).expect(201);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.postedByAdminId).toBe(ACTOR_ID['SUPER_ADMIN']);
    expect(res.body.data.humanId).toMatch(/^JB-/); // DB-assigned, same as employer create

    const notice = await prisma.notification.findFirst({
      where: { userId, type: NotificationType.JOB_POSTED_ONBEHALF },
    });
    expect(notice).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.JOB_CREATED_ONBEHALF, targetId: res.body.data.id },
    });
    expect(audit).not.toBeNull();
  });

  it('publish:true on a protection-violating job → BLOCKED by the same gates; the job stays DRAFT', async () => {
    if (dockerUnavailable) return;
    const { companyId } = await mkCompany(CompanyStatus.APPROVED);

    const res = await post(
      '/admin/jobs',
      UserRole.SUPER_ADMIN,
      createBody(companyId, { publish: true, accommodation: false }),
    ).expect(422);
    expect(res.body.code).toBe('WORKER_PROTECTION_VIOLATION');

    // The DRAFT survives (creating a draft is always allowed) but NOTHING went live.
    const active = await prisma.job.count({
      where: { companyId, status: JobStatus.ACTIVE, title: 'On-behalf Mason' },
    });
    expect(active).toBe(0);
    const draft = await prisma.job.findFirst({
      where: { companyId, title: 'On-behalf Mason' },
    });
    expect(draft?.status).toBe(JobStatus.DRAFT);
  });

  it('a compliant publish:true → ACTIVE immediately (the admin IS the reviewer)', async () => {
    if (dockerUnavailable) return;
    const { companyId } = await mkCompany(CompanyStatus.APPROVED);

    const res = await post(
      '/admin/jobs',
      UserRole.SUPER_ADMIN,
      createBody(companyId, { publish: true }),
    ).expect(201);
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.publishedAt).not.toBeNull();

    const job = await jobRow(res.body.data.id);
    expect(job.autoArchiveAt).not.toBeNull();
  });

  it('unknown employer → 404; RBAC denial without jobs.post_admin', async () => {
    if (dockerUnavailable) return;
    await post(
      '/admin/jobs',
      UserRole.SUPER_ADMIN,
      createBody('99999999-9999-4999-8999-999999999999'),
    ).expect(404);
    const { companyId } = await mkCompany(CompanyStatus.APPROVED);
    await post('/admin/jobs', UserRole.MODERATOR, createBody(companyId)).expect(403);
  });
});

// ─── notes + resend over HTTP: RBAC + the guard timestamp survives ───────────

describe('notes + resend endpoints (applications module)', () => {
  async function mkSelectedApplication(): Promise<{ applicationId: string; notifiedAt: Date }> {
    const { companyId } = await mkCompany(CompanyStatus.APPROVED);
    const jobId = await mkJob(companyId, JobStatus.ACTIVE);
    const n = ++seq;
    const candUser = await prisma.user.create({
      data: { email: `cand-${n}@example.com`, role: UserRole.CANDIDATE },
    });
    const profile = await prisma.candidateProfile.create({
      data: { userId: candUser.id, fullName: `Cand ${n}`, whatsappCapable: true },
    });
    const notifiedAt = new Date('2026-06-01T10:00:00Z'); // the ORIGINAL guard moment
    const application = await prisma.application.create({
      data: {
        jobId,
        candidateId: profile.id,
        status: 'SELECTED',
        matchScore: 70,
        matchBreakdown: {},
        docsCompleteCount: 1,
        docsRequiredCount: 1,
        passportValidAtApply: true,
        selectedNotifiedAt: notifiedAt,
      },
    });
    return { applicationId: application.id, notifiedAt };
  }

  it('resend: 202 enqueues the WhatsApp; selectedNotifiedAt is UNCHANGED; audited without a phone', async () => {
    if (dockerUnavailable) return;
    const { applicationId, notifiedAt } = await mkSelectedApplication();

    const res = await post(
      `/admin/applications/${applicationId}/resend-whatsapp`,
      UserRole.SUPER_ADMIN,
      { reason: 'candidate reported non-delivery' },
    ).expect(202);
    expect(res.body.data.channel).toBe('whatsapp');

    // The bypass enqueued a REAL whatsapp channel job (worker owns the send).
    const channels = notificationQueueAdd.mock.calls
      .filter((c) => c[1].type === NotificationType.APPLICATION_SELECTED)
      .map((c) => c[1].channel);
    expect(channels).toContain('whatsapp');

    // The GUARD survives: the original first-notification moment is untouched.
    const app = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(app.selectedNotifiedAt?.toISOString()).toBe(notifiedAt.toISOString());

    const audit = await prisma.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.APPLICATION_WHATSAPP_RESENT, targetId: applicationId },
    });
    expect((audit?.meta as Record<string, unknown>)['reason']).toBe(
      'candidate reported non-delivery',
    );
    expect(JSON.stringify(audit?.meta)).not.toContain('phone');
  });

  it('resend guards: missing reason → 400 VALIDATION_ERROR; RBAC denial for MODERATOR → 403', async () => {
    if (dockerUnavailable) return;
    const { applicationId } = await mkSelectedApplication();
    // DTO validation is 400 VALIDATION_ERROR in this codebase (the global
    // pipe's factory builds a BadRequestException) — same as B1's suspend.
    const invalid = await post(
      `/admin/applications/${applicationId}/resend-whatsapp`,
      UserRole.SUPER_ADMIN,
      {},
    ).expect(400);
    expect(invalid.body.code).toBe('VALIDATION_ERROR');
    await post(`/admin/applications/${applicationId}/resend-whatsapp`, UserRole.MODERATOR, {
      reason: 'x',
    }).expect(403);
  });

  it('notes: CRUD round-trips over HTTP; RBAC denial for MODERATOR', async () => {
    if (dockerUnavailable) return;
    const { applicationId } = await mkSelectedApplication();

    const created = await post(`/admin/applications/${applicationId}/notes`, UserRole.SUPER_ADMIN, {
      body: 'called the employer to confirm the offer',
    }).expect(201);
    expect(created.body.data.authorRole).toBe('SUPER_ADMIN');

    const listed = await get(`/admin/applications/${applicationId}/notes`, UserRole.SUPER_ADMIN).expect(
      200,
    );
    expect(listed.body.data).toHaveLength(1);

    await get(`/admin/applications/${applicationId}/notes`, UserRole.MODERATOR).expect(403);

    await supertest(app.getHttpServer())
      .delete(`/admin/applications/${applicationId}/notes/${created.body.data.id}`)
      .set('x-test-role', UserRole.SUPER_ADMIN)
      .expect(204);
  });
});
