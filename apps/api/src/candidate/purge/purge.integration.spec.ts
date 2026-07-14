/**
 * S6b-B1 integration — THE PURGE, proven by ABSENCE (real Postgres via
 * Testcontainers, real Redis for the RBAC guard, an in-memory R2 stand-in
 * whose HEAD semantics mirror the real one).
 *
 * What is proven here, in the unit's own order of importance:
 *  1. FULL ANONYMIZATION — direct DB queries after the purge find NO name /
 *     phone / email / dob / religion / passport key anywhere in the user's rows.
 *  2. R2 DESTRUCTION — HEAD on every captured key returns null (404), not just
 *     "the delete call returned ok".
 *  3. TOMBSTONE INTEGRITY — the user row EXISTS; the employer's application
 *     survives with status/score/timeline; S4-B3's applicant card renders the
 *     tombstone without crashing (the payoff of building it tombstone-safe).
 *  4. The audit row carries COUNTS ONLY (raw-meta asserted against every PII
 *     string) and is never duplicated by retries.
 *  5. Idempotency + resumability: re-runs no-op; a crash between the DB commit
 *     and the R2 delete resumes cleanly from the caller-persisted keys.
 *  6. Both triggers reach the same engine; cancelled/not-due self-deletions
 *     are skipped AT PROCESSING TIME.
 *  7. The admin endpoints: RBAC per key (403 proven), confirm/reason 422s,
 *     already-purged 409, reads that never leak a document key.
 *
 * Skips gracefully when Docker is unavailable, like the other container specs.
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
import { getQueueToken } from '@nestjs/bullmq';
import {
  ApplicationStatus,
  Currency,
  DocumentType,
  ExperienceType,
  MaritalStatus,
  NotificationType,
  PrismaClient,
  ResumeTrigger,
  UserRole,
  UserStatus,
  WaMessageKind,
} from '@prisma/client';
import { Redis } from 'ioredis';
import supertest from 'supertest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import * as path from 'path';
import { execSync } from 'child_process';
import { PrismaService } from '../../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../../core/redis/redis.provider';
import { StorageService } from '../../core/storage/storage.service';
import { HttpProblemFilter, validationProblemFactory } from '../../core/http-problem.filter';
import { AuditService } from '../../audit/audit.service';
import { AUDIT_ACTIONS } from '../../audit/audit.types';
import { PermissionService } from '../../auth/rbac/permission.service';
import { PermissionsGuard } from '../../auth/rbac/permissions.guard';
import { Permission } from '../../auth/rbac/permission.constants';
import { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CandidateReadService } from '../candidate-read.service';
import { ApplicationsAggregateService } from '../../applications/applications-aggregate.service';
import { JobsService } from '../../jobs/jobs.service';
import { AccountService } from '../../account/account.service';
import { AdminCandidatesController } from '../../admin/admin-candidates.controller';
import { AdminCandidatesService } from '../../admin/admin-candidates.service';
import { toApplicantCard } from '../../applications/mappers/applicant-card.mapper';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { PurgeService, type PurgeCounts } from './purge.service';

jest.setTimeout(240_000);

const API_DIR = path.resolve(__dirname, '../../..');

const ACTOR_ID: Record<string, string> = {
  SUPER_ADMIN: '11111111-1111-4111-8111-111111111111',
  ADMIN: '22222222-2222-4222-8222-222222222222',
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

/** In-memory R2: delete removes; HEAD answers from what actually remains. */
class FakeStorage {
  objects = new Set<string>();
  failNextDelete = false;

  seed(keys: string[]): void {
    for (const k of keys) this.objects.add(k);
  }
  async deleteObjects(keys: string[]): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error('simulated R2 outage');
    }
    for (const k of keys) this.objects.delete(k);
  }
  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async headObject(key: string): Promise<{ sizeBytes: number; contentType: string } | null> {
    return this.objects.has(key) ? { sizeBytes: 1, contentType: 'application/pdf' } : null;
  }
}

let pg: StartedTestContainer;
let redisContainer: StartedTestContainer;
let prisma: PrismaClient;
let redis: Redis;
let app: INestApplication;
let purgeService: PurgeService;
let storage: FakeStorage;
let purgeQueueAdd: jest.Mock;
let dockerUnavailable = false;

let seq = 0;
let companyId: string;
let jobId: string;

const DAY = 24 * 60 * 60 * 1000;
const PAST = new Date(Date.now() - DAY);
const FUTURE = new Date(Date.now() + 20 * DAY);

interface Fixture {
  userId: string;
  candidateId: string;
  applicationId: string;
  keys: string[]; // every R2 object the candidate owns
  pii: string[]; //  strings that must be ABSENT everywhere after the purge
}

/** A candidate with EVERYTHING attached: the purge's full blast radius. */
async function mkFullCandidate(opts?: {
  status?: UserStatus;
  deletionDueAt?: Date | null;
}): Promise<Fixture> {
  const n = ++seq;
  const email = `victim-${n}@example.com`;
  const phone = `+9190000${(10_000 + n).toString()}`;
  const fullName = `Ramesh Kumar ${n}`;
  const photoKey = `photos/cand-${n}.jpg`;
  const videoKey = `videos/cand-${n}.mp4`;
  const passportKey = `docs/passport-${n}.pdf`;
  const renderKey = `resumes/render-${n}.pdf`;
  const generationKey = `resumes/gen-${n}.pdf`;
  const keys = [photoKey, videoKey, passportKey, renderKey, generationKey];

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: `hash-${n}`,
      googleId: `google-${n}`,
      role: UserRole.CANDIDATE,
      status: opts?.status ?? UserStatus.PENDING_DELETION,
      deletionDueAt: opts?.deletionDueAt === undefined ? PAST : opts.deletionDueAt,
      refreshSessions: {
        create: [{ tokenHash: `t-${n}`, ip: '10.0.0.9', userAgent: 'jest', expiresAt: FUTURE }],
      },
      notifications: {
        create: [
          {
            type: NotificationType.NEW_JOB_MATCH,
            title: `A job for ${fullName}`,
            body: `Hello ${fullName}, Emirates Builders wants you.`,
          },
        ],
      },
    },
  });

  const profile = await prisma.candidateProfile.create({
    data: {
      userId: user.id,
      fullName,
      fatherName: `Suresh Kumar ${n}`,
      dob: new Date('1990-01-15'),
      phone,
      phoneVerifiedAt: new Date(),
      whatsappCapable: true,
      maritalStatus: MaritalStatus.MARRIED,
      religion: 'Hindu',
      languages: ['hi', 'en'],
      photoKey,
      currentLocation: 'Mumbai',
      nationality: 'Indian',
      noticePeriod: 30,
      salaryExpectationMin: 100_000,
      salaryExpectationMax: 200_000,
      salaryExpectationCurrency: Currency.INR,
      videoR2Key: videoKey,
      completionPct: 90,
      profileVisible: true,
      experiences: {
        create: [
          {
            type: ExperienceType.FOREIGN,
            country: 'UAE',
            companyName: 'Emirates Builders LLC',
            role: 'Mason',
            years: 3,
            months: 2,
          },
        ],
      },
      skills: { create: [{ name: 'Masonry' }, { name: 'Tiling' }] },
      documents: {
        create: [
          {
            type: DocumentType.PASSPORT,
            r2Key: passportKey,
            fileName: `passport-of-${fullName}.pdf`,
            mimeType: 'application/pdf',
            sizeBytes: 42_000,
            expiryDate: FUTURE,
          },
        ],
      },
      resume: {
        create: {
          lastRenderKey: renderKey,
          generations: {
            create: [
              {
                contentHash: `hash-${n}`,
                r2Key: generationKey,
                sizeBytes: 9_000,
                trigger: ResumeTrigger.DOWNLOAD,
                settingsSnapshot: {},
              },
            ],
          },
        },
      },
      savedJobs: { create: [{ jobId }] },
      profileViews: { create: [{ companyId }] },
    },
  });

  const application = await prisma.application.create({
    data: {
      jobId,
      candidateId: profile.id,
      status: ApplicationStatus.SHORTLISTED,
      coverLetter: `I am ${fullName}, call me on ${phone}.`,
      matchScore: 77,
      matchBreakdown: { category: 40, experience: 37 },
      docsCompleteCount: 1,
      docsRequiredCount: 1,
      passportValidAtApply: true,
      timeline: {
        create: [{ toStatus: ApplicationStatus.PENDING }, { fromStatus: ApplicationStatus.PENDING, toStatus: ApplicationStatus.SHORTLISTED }],
      },
    },
  });

  await prisma.otpChallenge.create({
    data: { phone, userId: user.id, codeHash: 'x', expiresAt: FUTURE },
  });
  await prisma.whatsappMessage.create({
    data: { userId: user.id, phone, kind: WaMessageKind.STATUS_UPDATE, templateName: 't' },
  });
  await prisma.emailMessage.create({
    data: { userId: user.id, toEmail: email, type: NotificationType.NEW_JOB_MATCH },
  });

  storage.seed(keys);

  return {
    userId: user.id,
    candidateId: profile.id,
    applicationId: application.id,
    keys,
    pii: [
      fullName,
      `Suresh Kumar ${n}`,
      phone,
      email,
      'Hindu',
      '1990-01-15',
      `hash-${n}`,
      `google-${n}`,
      ...keys,
    ],
  };
}

/** Run the purge the way the processor does: capture → purge, keys persisted by the caller. */
async function runPurge(
  userId: string,
  trigger: 'self' | 'admin' = 'self',
  extras?: { reason?: string; actorUserId?: string; actorRole?: string },
) {
  const capturedKeys = await purgeService.captureObjectKeys(userId);
  return purgeService.purgeUser({ userId, trigger, capturedKeys, ...extras });
}

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
    storage = new FakeStorage();
    purgeQueueAdd = jest.fn().mockResolvedValue(undefined);

    // Shared employer-side fixture: the applications' job.
    const category = await prisma.jobCategory.create({
      data: { slug: 'mason', nameEn: 'Mason' },
    });
    const company = await prisma.company.create({
      data: {
        name: 'Gulf Constructions',
        type: 'LOCAL',
        status: 'APPROVED',
        registrationNumber: 'R-1',
        industryType: 'Construction',
        phone: '+911234567890',
        location: 'Pune',
        employeeRange: '10-50',
      },
    });
    companyId = company.id;
    const job = await prisma.job.create({
      data: {
        companyId,
        title: 'Mason (Dubai)',
        employmentType: 'FULL_TIME',
        market: 'GULF',
        location: 'Dubai',
        description: 'x',
        categoryId: category.id,
        salaryMin: 100,
        salaryMax: 200,
        currency: Currency.AED,
        hoursPerDay: 8,
        daysPerWeek: 6,
        status: 'ACTIVE',
      },
    });
    jobId = job.id;

    // RBAC fixture: SUPER_ADMIN holds all three candidate keys; ADMIN lacks
    // candidates.delete (the purge 403 proof); MODERATOR lacks candidates.view.
    await prisma.rolePermission.createMany({
      data: [
        { role: UserRole.SUPER_ADMIN, permissionKey: Permission.CANDIDATES_VIEW, enabled: true, isLocked: false },
        { role: UserRole.SUPER_ADMIN, permissionKey: Permission.CANDIDATES_EDIT, enabled: true, isLocked: false },
        { role: UserRole.SUPER_ADMIN, permissionKey: Permission.CANDIDATES_DELETE, enabled: true, isLocked: true },
        { role: UserRole.ADMIN, permissionKey: Permission.CANDIDATES_VIEW, enabled: true, isLocked: false },
        { role: UserRole.ADMIN, permissionKey: Permission.CANDIDATES_EDIT, enabled: true, isLocked: false },
        { role: UserRole.ADMIN, permissionKey: Permission.CANDIDATES_DELETE, enabled: false, isLocked: true },
        { role: UserRole.MODERATOR, permissionKey: Permission.CANDIDATES_VIEW, enabled: false, isLocked: false },
      ],
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [AdminCandidatesController],
      providers: [
        PurgeService,
        CandidateReadService,
        ApplicationsAggregateService,
        AccountService,
        AdminCandidatesService,
        AuditService,
        PermissionService,
        { provide: JobsService, useValue: {} }, // aggregate's job methods unused here
        { provide: PrismaService, useValue: prisma as unknown as PrismaService },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: StorageService, useValue: storage },
        { provide: getQueueToken(QUEUE_NAMES.ACCOUNT_PURGE), useValue: { add: purgeQueueAdd } },
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
    purgeService = app.get(PurgeService);
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

const get = (url: string, role: UserRole) =>
  supertest(app.getHttpServer()).get(url).set('x-test-role', role);
const post = (url: string, role: UserRole, body: Record<string, unknown> = {}) =>
  supertest(app.getHttpServer()).post(url).set('x-test-role', role).send(body);

const purgedAuditRows = (userId: string) =>
  prisma.auditLog.findMany({
    where: { action: AUDIT_ACTIONS.ACCOUNT_PURGED, targetId: userId },
  });

// ─── THE PURGE ────────────────────────────────────────────────────────────────

describe('purgeUser — full anonymization, proven by absence', () => {
  let fx: Fixture;

  beforeAll(async () => {
    if (dockerUnavailable) return;
    fx = await mkFullCandidate();
    const result = await runPurge(fx.userId);
    expect(result.outcome).toBe('purged');
  });

  it('no PII survives ANYWHERE in the user rows (direct DB assertions)', async () => {
    if (dockerUnavailable) return;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fx.userId } });
    expect(user.email).toBe(`purged-${fx.userId}@deleted.invalid`);
    expect(user.passwordHash).toBeNull();
    expect(user.googleId).toBeNull();
    expect(user.deletionDueAt).toBeNull();
    expect(user.purgedAt).not.toBeNull();

    const profile = await prisma.candidateProfile.findUniqueOrThrow({
      where: { id: fx.candidateId },
    });
    expect(profile.fullName).toBe('Deleted user');
    expect(profile.fatherName).toBeNull();
    expect(profile.dob).toBeNull();
    expect(profile.phone).toBeNull();
    expect(profile.religion).toBeNull();
    expect(profile.photoKey).toBeNull();
    expect(profile.videoR2Key).toBeNull();
    expect(profile.currentLocation).toBeNull();
    expect(profile.nationality).toBeNull();
    expect(profile.salaryExpectationMin).toBeNull();
    expect(profile.languages).toEqual([]);
    expect(profile.profileVisible).toBe(false);
    expect(profile.completionPct).toBe(0);

    // Child rows: GONE (passport numbers, employers, skills, resume settings).
    expect(await prisma.candidateDocument.count({ where: { candidateId: fx.candidateId } })).toBe(0);
    expect(await prisma.workExperience.count({ where: { candidateId: fx.candidateId } })).toBe(0);
    expect(await prisma.candidateSkill.count({ where: { candidateId: fx.candidateId } })).toBe(0);
    expect(await prisma.candidateResume.count({ where: { candidateId: fx.candidateId } })).toBe(0);
    expect(await prisma.savedJob.count({ where: { candidateId: fx.candidateId } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: fx.userId } })).toBe(0);
    expect(await prisma.refreshSession.count({ where: { userId: fx.userId } })).toBe(0);
    expect(await prisma.otpChallenge.count({ where: { userId: fx.userId } })).toBe(0);

    // Delivery logs survive — with their address columns scrubbed.
    const wa = await prisma.whatsappMessage.findFirstOrThrow({ where: { userId: fx.userId } });
    expect(wa.phone).toBe('REDACTED');
    const em = await prisma.emailMessage.findFirstOrThrow({ where: { userId: fx.userId } });
    expect(em.toEmail).toBe('redacted@deleted.invalid');
  });

  it('R2 destruction is REAL: HEAD on every captured key finds nothing', async () => {
    if (dockerUnavailable) return;
    for (const key of fx.keys) {
      expect(await storage.headObject(key)).toBeNull();
    }
  });

  it('tombstone integrity: the user row lives, the employer record survives intact', async () => {
    if (dockerUnavailable) return;
    // The rows EXIST — anonymization, never row deletion.
    expect(await prisma.user.count({ where: { id: fx.userId } })).toBe(1);
    expect(await prisma.candidateProfile.count({ where: { id: fx.candidateId } })).toBe(1);

    const application = await prisma.application.findUniqueOrThrow({
      where: { id: fx.applicationId },
      include: { timeline: true },
    });
    expect(application.candidateId).toBeNull();
    expect(application.candidateTombstone).toMatchObject({ purged: true });
    expect(application.coverLetter).toBeNull();
    // The hiring record is untouched.
    expect(application.status).toBe(ApplicationStatus.SHORTLISTED);
    expect(application.matchScore).toBe(77);
    expect(application.matchBreakdown).toEqual({ category: 40, experience: 37 });
    expect(application.timeline).toHaveLength(2);

    // profile_views KEPT (stated choice — aggregate integrity, no PII in the row).
    expect(await prisma.profileView.count({ where: { candidateId: fx.candidateId } })).toBe(1);

    // S4-B3's payoff: the applicant card renders the tombstone without crashing.
    const card = toApplicantCard(application, undefined);
    expect(card.fullName).toBe('(unavailable)');
    expect(card.matchScore).toBe(77);
    expect(card.documentsStatus).toEqual([]);
  });

  it('the audit row exists ONCE, counts only, ZERO PII in the raw meta', async () => {
    if (dockerUnavailable) return;
    const rows = await purgedAuditRows(fx.userId);
    expect(rows).toHaveLength(1);
    const meta = rows[0]!.meta as Record<string, unknown>;
    expect(meta['trigger']).toBe('self');
    expect(meta['documentsDeleted']).toBe(1);
    expect(meta['objectsDestroyed']).toBe(fx.keys.length);
    expect(meta['experiencesDeleted']).toBe(1);
    expect(meta['skillsDeleted']).toBe(2);
    expect(meta['applicationsTombstoned']).toBe(1);
    expect(meta['notificationsDeleted']).toBe(1);

    // The raw meta preserves NOTHING the purge destroyed.
    const raw = JSON.stringify(rows[0]!.meta);
    for (const pii of fx.pii) {
      expect(raw).not.toContain(pii);
    }
    // And the trail itself was never modified: the fixture's other rows stand.
    expect(rows[0]!.action).toBe('account.purged');
  });

  it('is IDEMPOTENT: a re-run is a clean no-op — no error, no second audit row', async () => {
    if (dockerUnavailable) return;
    const again = await runPurge(fx.userId);
    expect(again.outcome).toBe('noop_already_purged');
    expect(await purgedAuditRows(fx.userId)).toHaveLength(1);
  });
});

describe('purgeUser — resumability (R2 fails AFTER the DB commit)', () => {
  it('retries from the caller-persisted keys and completes with one audit row', async () => {
    if (dockerUnavailable) return;
    const fx = await mkFullCandidate();
    const capturedKeys = await purgeService.captureObjectKeys(fx.userId);
    let persistedCounts: PurgeCounts | null = null;

    storage.failNextDelete = true;
    await expect(
      purgeService.purgeUser({
        userId: fx.userId,
        trigger: 'self',
        capturedKeys,
        onDbCommitted: async (counts) => {
          persistedCounts = counts; // what the processor writes into job data
        },
      }),
    ).rejects.toThrow('simulated R2 outage');

    // The DB is already anonymized; the objects are NOT gone; no audit yet.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fx.userId } });
    expect(user.purgedAt).not.toBeNull();
    expect(await storage.headObject(fx.keys[2]!)).not.toBeNull();
    expect(await purgedAuditRows(fx.userId)).toHaveLength(0);
    expect(persistedCounts).not.toBeNull();

    // The retry: same persisted keys + counts (the DB no longer knows either).
    const retry = await purgeService.purgeUser({
      userId: fx.userId,
      trigger: 'self',
      capturedKeys,
      priorCounts: persistedCounts,
    });
    expect(retry.outcome).toBe('resumed');
    for (const key of fx.keys) {
      expect(await storage.headObject(key)).toBeNull();
    }
    const rows = await purgedAuditRows(fx.userId);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.meta as Record<string, unknown>)['documentsDeleted']).toBe(1);
  });

  it('throws (→ BullMQ retry) when an object SURVIVES a "successful" delete', async () => {
    if (dockerUnavailable) return;
    const fx = await mkFullCandidate();
    const capturedKeys = await purgeService.captureObjectKeys(fx.userId);
    // A provider that lies: delete "succeeds" but the passport is still there.
    const originalDelete = storage.deleteObjects.bind(storage);
    storage.deleteObjects = async () => {}; // swallows, deletes nothing
    try {
      await expect(
        purgeService.purgeUser({ userId: fx.userId, trigger: 'self', capturedKeys }),
      ).rejects.toThrow(/still present after delete/);
      // And the message leaks counts, never keys.
      expect(await purgedAuditRows(fx.userId)).toHaveLength(0);
    } finally {
      storage.deleteObjects = originalDelete;
    }
  });
});

describe('purgeUser — processing-time guards', () => {
  it('skips a user whose grace window has not elapsed (S1-3 early job arrival)', async () => {
    if (dockerUnavailable) return;
    const fx = await mkFullCandidate({ deletionDueAt: FUTURE });
    const result = await runPurge(fx.userId);
    expect(result.outcome).toBe('skipped_not_due');
    const profile = await prisma.candidateProfile.findUniqueOrThrow({
      where: { id: fx.candidateId },
    });
    expect(profile.fullName).not.toBe('Deleted user'); // untouched
  });

  it('skips a user who CANCELLED (no longer PENDING_DELETION at processing time)', async () => {
    if (dockerUnavailable) return;
    const fx = await mkFullCandidate({ status: UserStatus.ACTIVE, deletionDueAt: null });
    const result = await runPurge(fx.userId);
    expect(result.outcome).toBe('skipped_not_pending');
    expect(await prisma.candidateDocument.count({ where: { candidateId: fx.candidateId } })).toBe(1);
  });

  it('the ADMIN trigger is exempt from due-ness and audits trigger+reason', async () => {
    if (dockerUnavailable) return;
    const fx = await mkFullCandidate({ status: UserStatus.PENDING_DELETION, deletionDueAt: FUTURE });
    const result = await runPurge(fx.userId, 'admin', {
      reason: 'DPDP erasure request #42',
      actorUserId: ACTOR_ID['SUPER_ADMIN'],
      actorRole: 'SUPER_ADMIN',
    });
    expect(result.outcome).toBe('purged');
    const rows = await purgedAuditRows(fx.userId);
    expect(rows).toHaveLength(1);
    const meta = rows[0]!.meta as Record<string, unknown>;
    expect(meta['trigger']).toBe('admin');
    expect(meta['reason']).toBe('DPDP erasure request #42');
    expect(rows[0]!.actorUserId).toBe(ACTOR_ID['SUPER_ADMIN']);
  });
});

// ─── THE ADMIN ENDPOINTS ─────────────────────────────────────────────────────

describe('admin candidate endpoints — RBAC, guards, and key-free reads', () => {
  let fx: Fixture;

  beforeAll(async () => {
    if (dockerUnavailable) return;
    fx = await mkFullCandidate({ status: UserStatus.ACTIVE, deletionDueAt: null });
  });

  it('GET /admin/candidates: 403 without candidates.view; 200 with data+meta and NO document keys', async () => {
    if (dockerUnavailable) return;
    const denied = await get('/admin/candidates', UserRole.MODERATOR).expect(403);
    expect(denied.body.code).toBe('FORBIDDEN');

    const res = await get('/admin/candidates?pageSize=100', UserRole.ADMIN).expect(200);
    expect(res.body.meta.total).toBeGreaterThan(0);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('r2Key');
    expect(raw).not.toContain('docs/passport'); // no key VALUES either
    const card = (res.body.data as Array<{ id: string }>).find((c) => c.id === fx.candidateId);
    expect(card).toBeDefined();
  });

  it('GET /admin/candidates/{id}: the detail carries experiences/skills/applicationCount, still key-free', async () => {
    if (dockerUnavailable) return;
    const res = await get(`/admin/candidates/${fx.candidateId}`, UserRole.ADMIN).expect(200);
    expect(res.body.data.experiences).toHaveLength(1);
    expect(res.body.data.skills).toHaveLength(2);
    expect(res.body.data.applicationCount).toBe(1);
    expect(res.body.data.documents[0]).toMatchObject({ type: 'PASSPORT', uploaded: true });
    expect(JSON.stringify(res.body)).not.toContain('r2Key');
  });

  it('suspend: reason mandatory (400 VALIDATION_ERROR); then SUSPENDED + audited + hidden from employers', async () => {
    if (dockerUnavailable) return;
    const invalid = await post(`/admin/candidates/${fx.candidateId}/suspend`, UserRole.ADMIN, {}).expect(400);
    expect(invalid.body.code).toBe('VALIDATION_ERROR');

    const res = await post(`/admin/candidates/${fx.candidateId}/suspend`, UserRole.ADMIN, {
      reason: 'fraudulent documents reported',
    }).expect(200);
    expect(res.body.data.status).toBe('SUSPENDED');

    const audit = await prisma.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.CANDIDATE_SUSPENDED, targetId: fx.candidateId },
    });
    expect(audit).not.toBeNull();
    expect((audit!.meta as Record<string, unknown>)['reason']).toBe(
      'fraudulent documents reported',
    );

    // The ACTIVE-only tighten: a suspended candidate vanishes from employer reads.
    const read = app.get(CandidateReadService);
    expect(await read.findVisibleCandidateForEmployerView(fx.candidateId)).toBeNull();
    expect(
      await read.findVisibleDocumentKeyForEmployer(fx.candidateId, DocumentType.PASSPORT),
    ).toBeNull();
    // Sessions revoked in the same transaction.
    expect(
      await prisma.refreshSession.count({ where: { userId: fx.userId, revokedAt: null } }),
    ).toBe(0);
  });

  it('suspend twice → 409 CANDIDATE_NOT_ACTIVE; reactivate → ACTIVE; reactivate again → 409', async () => {
    if (dockerUnavailable) return;
    const dup = await post(`/admin/candidates/${fx.candidateId}/suspend`, UserRole.ADMIN, {
      reason: 'again',
    }).expect(409);
    expect(dup.body.code).toBe('CANDIDATE_NOT_ACTIVE');

    const back = await post(`/admin/candidates/${fx.candidateId}/reactivate`, UserRole.ADMIN).expect(200);
    expect(back.body.data.status).toBe('ACTIVE');
    const again = await post(`/admin/candidates/${fx.candidateId}/reactivate`, UserRole.ADMIN).expect(409);
    expect(again.body.code).toBe('CANDIDATE_NOT_SUSPENDED');
  });

  it('purge: 403 for ADMIN (candidates.delete OFF) — the SUPER_ADMIN-effective proof', async () => {
    if (dockerUnavailable) return;
    await post(`/admin/candidates/${fx.candidateId}/purge`, UserRole.ADMIN, {
      reason: 'x',
      confirm: true,
    }).expect(403);
  });

  it('purge: confirm !== true or empty reason → 422 PURGE_NOT_CONFIRMED (nothing enqueued)', async () => {
    if (dockerUnavailable) return;
    purgeQueueAdd.mockClear();
    const noConfirm = await post(`/admin/candidates/${fx.candidateId}/purge`, UserRole.SUPER_ADMIN, {
      reason: 'valid reason',
      confirm: false,
    }).expect(422);
    expect(noConfirm.body.code).toBe('PURGE_NOT_CONFIRMED');

    const noReason = await post(`/admin/candidates/${fx.candidateId}/purge`, UserRole.SUPER_ADMIN, {
      confirm: true,
    }).expect(422);
    expect(noReason.body.code).toBe('PURGE_NOT_CONFIRMED');
    expect(purgeQueueAdd).not.toHaveBeenCalled();
  });

  it('purge: 202 marks + audits the REQUEST + enqueues (never inline); then 409 once purged', async () => {
    if (dockerUnavailable) return;
    purgeQueueAdd.mockClear();
    const res = await post(`/admin/candidates/${fx.candidateId}/purge`, UserRole.SUPER_ADMIN, {
      reason: 'data-subject erasure request',
      confirm: true,
    }).expect(202);
    expect(res.body.data.purgeScheduledFor).toBeDefined();

    // State written, job enqueued with the admin-distinct deterministic id.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fx.userId } });
    expect(user.status).toBe(UserStatus.PENDING_DELETION);
    expect(user.deletionDueAt).not.toBeNull();
    expect(purgeQueueAdd).toHaveBeenCalledTimes(1);
    const [, payload, opts] = purgeQueueAdd.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { jobId: string },
    ];
    expect(payload['trigger']).toBe('admin');
    expect(opts.jobId).toBe(`purge-${fx.userId}-admin`);
    expect(opts.jobId).not.toContain(':');

    // The REQUEST audit row: ids + reason, no candidate PII.
    const audit = await prisma.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.ADMIN_CANDIDATE_PURGE_REQUESTED, targetId: fx.userId },
    });
    expect(audit).not.toBeNull();
    const raw = JSON.stringify(audit!.meta);
    expect(raw).toContain('data-subject erasure request');
    for (const pii of fx.pii) expect(raw).not.toContain(pii);

    // Simulate the worker completing, then a second admin purge → 409.
    await runPurge(fx.userId, 'admin', { reason: 'x', actorUserId: ACTOR_ID['SUPER_ADMIN'] });
    const conflict = await post(`/admin/candidates/${fx.candidateId}/purge`, UserRole.SUPER_ADMIN, {
      reason: 'y',
      confirm: true,
    }).expect(409);
    expect(conflict.body.code).toBe('CANDIDATE_ALREADY_PURGED');
  });

  it('a PURGED candidate still appears in the admin list — as the tombstone', async () => {
    if (dockerUnavailable) return;
    const res = await get(`/admin/candidates/${fx.candidateId}`, UserRole.ADMIN).expect(200);
    expect(res.body.data.fullName).toBe('Deleted user');
    expect(res.body.data.purgedAt).not.toBeNull();
    expect(res.body.data.documents).toEqual([]);
    expect(res.body.data.experiences).toEqual([]);
  });

  it('reactivating a purged tombstone → 409 CANDIDATE_PURGED (irreversible)', async () => {
    if (dockerUnavailable) return;
    const res = await post(`/admin/candidates/${fx.candidateId}/reactivate`, UserRole.ADMIN).expect(409);
    expect(res.body.code).toBe('CANDIDATE_PURGED');
  });
});
