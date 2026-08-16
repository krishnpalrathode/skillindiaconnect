/**
 * Integration tests for the transition core against a real Postgres container.
 *
 * Iterates the matrix (every legal + illegal employer cell — three-absence on
 * illegal), the admin override path, the one-WhatsApp guard (re-entry + concurrent
 * race under FOR UPDATE), rollback-safety, employer scoping (404), and archived.
 *
 * Skips gracefully when Docker is unavailable.
 */
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import { Queue } from 'bullmq';
import { execSync } from 'child_process';
import * as path from 'path';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../core/prisma/prisma.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { JobsService } from '../jobs/jobs.service';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../audit/audit.service';
import { StatusService, TransitionActor } from './status.service';
import { EMPLOYER_LEGAL } from './transition.matrix';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');

let pg: StartedTestContainer;
let prismaClient: PrismaClient;
let service: StatusService;
let prismaSvc: PrismaService;
let candidateRead: CandidateReadService;
let notificationService: NotificationService;
let eventEmitter: EventEmitter2;
let queueAdd: jest.Mock;
let dockerUnavailable = false;

const CATEGORY_ID = 'st-cat-1';
const EMPLOYER_USER_ID = 'st-emp-1';
const CANDIDATE_USER_ID = 'st-cand-1';
let companyId: string;
let jobId: string;
let candidateId: string;

const ALL: ApplicationStatus[] = [
  ApplicationStatus.PENDING,
  ApplicationStatus.SHORTLISTED,
  ApplicationStatus.SELECTED,
  ApplicationStatus.REJECTED,
];

beforeAll(async () => {
  try {
    pg = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_USER: 'sic',
        POSTGRES_PASSWORD: 'sic',
        POSTGRES_DB: 'sic_status_svc',
      })
      .withExposedPorts(5432)
      .start();

    const url = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_status_svc`;
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
      create: { id: CATEGORY_ID, slug: 'st-general', nameEn: 'ST General' },
      update: {},
    });
    await prismaClient.user.create({
      data: { id: EMPLOYER_USER_ID, email: 'st-emp@example.com', role: UserRole.EMPLOYER },
    });
    const company = await prismaClient.company.create({
      data: {
        name: 'ST Co',
        type: CompanyType.FOREIGN,
        registrationNumber: 'ST-REG-1',
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
          salaryMin: 1000,
          salaryMax: 2000,
          currency: Currency.AED,
          hoursPerDay: 8,
          daysPerWeek: 6,
        },
      })
    ).id;
    await prismaClient.user.create({
      data: { id: CANDIDATE_USER_ID, email: 'st-cand@example.com', role: UserRole.CANDIDATE },
    });
    candidateId = (
      await prismaClient.candidateProfile.create({
        data: { userId: CANDIDATE_USER_ID, fullName: 'Amir', completionPct: 80 },
      })
    ).id;

    prismaSvc = prismaClient as unknown as PrismaService;
    candidateRead = new CandidateReadService(prismaSvc);
    const auditService = new AuditService(prismaSvc);
    eventEmitter = new EventEmitter2();
    queueAdd = jest.fn();
    notificationService = new NotificationService(prismaSvc, { add: queueAdd } as unknown as Queue);

    const jobsStub = {
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

    service = new StatusService(
      prismaSvc,
      jobsStub,
      candidateRead,
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
      console.warn('[status-service] Docker unavailable — tests will be skipped:', msg);
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
  await prismaClient.applicationTimelineEntry.deleteMany();
  await prismaClient.application.deleteMany();
  await prismaClient.notification.deleteMany();
  await prismaClient.auditLog.deleteMany();
  queueAdd.mockClear();
});

async function makeApp(
  status: ApplicationStatus,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const app = await prismaClient.application.create({
    data: {
      jobId,
      candidateId,
      status,
      matchScore: 50,
      matchBreakdown: {},
      docsCompleteCount: 2,
      docsRequiredCount: 2,
      passportValidAtApply: true,
      ...overrides,
    },
  });
  return app.id;
}

function employer(company = companyId): TransitionActor {
  return {
    type: 'EMPLOYER',
    userId: EMPLOYER_USER_ID,
    role: UserRole.EMPLOYER,
    companyId: company,
  };
}
function admin(): TransitionActor {
  return { type: 'ADMIN', userId: 'st-admin-1', role: UserRole.ADMIN };
}

function enqueuedChannels(): string[] {
  return queueAdd.mock.calls.map((c) => (c[1] as { channel: string }).channel);
}

function gatedIt(name: string, fn: () => Promise<void>): void {
  it(name, async () => {
    if (dockerUnavailable) return;
    await fn();
  });
}

// ── Exhaustive employer matrix (every from→to cell) ───────────────────────────
describe('StatusService — employer matrix (exhaustive)', () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const legal = EMPLOYER_LEGAL[from].includes(to);

      if (legal) {
        gatedIt(
          `LEGAL ${from} → ${to}: writes status + timeline + audit + notification`,
          async () => {
            const id = await makeApp(from);
            const res = await service.transition(id, to, employer());

            expect(res.status).toBe(to);

            const timeline = await prismaClient.applicationTimelineEntry.findMany({
              where: { applicationId: id },
            });
            expect(timeline).toHaveLength(1);
            expect(timeline[0]!.fromStatus).toBe(from);
            expect(timeline[0]!.toStatus).toBe(to);
            expect(timeline[0]!.actorRole).toBe(UserRole.EMPLOYER);
            expect(timeline[0]!.isAdminOverride).toBe(false);
            expect(timeline[0]!.overrideReason).toBeNull();

            const audits = await prismaClient.auditLog.findMany({
              where: { action: 'application.status.changed' },
            });
            expect(audits).toHaveLength(1);

            // In-app row always; WhatsApp only for a first SELECTED entry; email for all three.
            const inApp = await prismaClient.notification.count({
              where: { userId: CANDIDATE_USER_ID },
            });
            expect(inApp).toBe(1);
            const channels = enqueuedChannels();
            expect(channels).toContain('email');
            if (to === ApplicationStatus.SELECTED) {
              expect(channels).toContain('whatsapp');
            } else {
              expect(channels).not.toContain('whatsapp');
            }
          },
        );
      } else {
        gatedIt(
          `ILLEGAL ${from} → ${to}: 422 + three absences (state, timeline, notification)`,
          async () => {
            const id = await makeApp(from);
            await expect(service.transition(id, to, employer())).rejects.toMatchObject({
              response: {
                code: 'ILLEGAL_TRANSITION',
                meta: { from, to, allowed: EMPLOYER_LEGAL[from] },
              },
            });

            const app = await prismaClient.application.findUnique({ where: { id } });
            expect(app!.status).toBe(from); // no state change
            expect(
              await prismaClient.applicationTimelineEntry.count({ where: { applicationId: id } }),
            ).toBe(0);
            expect(
              await prismaClient.notification.count({ where: { userId: CANDIDATE_USER_ID } }),
            ).toBe(0);
            expect(queueAdd).not.toHaveBeenCalled();
          },
        );
      }
    }
  }
});

// ── Admin override ────────────────────────────────────────────────────────────
describe('StatusService — admin override', () => {
  gatedIt(
    'every corrective move succeeds WITH a reason (timeline flagged + reason + ADMIN_OVERRIDE audit)',
    async () => {
      // SELECTED → REJECTED (backward, employer-illegal) via admin.
      const id = await makeApp(ApplicationStatus.SELECTED, { selectedNotifiedAt: new Date() });
      await service.transition(id, ApplicationStatus.REJECTED, admin(), {
        overrideReason: 'candidate withdrew offline',
      });

      const app = await prismaClient.application.findUnique({ where: { id } });
      expect(app!.status).toBe(ApplicationStatus.REJECTED);

      const timeline = await prismaClient.applicationTimelineEntry.findFirst({
        where: { applicationId: id },
      });
      expect(timeline!.isAdminOverride).toBe(true);
      expect(timeline!.overrideReason).toBe('candidate withdrew offline');
      expect(timeline!.actorRole).toBe(UserRole.ADMIN);

      const audits = await prismaClient.auditLog.findMany({
        where: { action: 'application.admin_override' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]!.meta).toMatchObject({ overrideReason: 'candidate withdrew offline' });
    },
  );

  gatedIt('missing reason → 422 OVERRIDE_REASON_REQUIRED before any write', async () => {
    const id = await makeApp(ApplicationStatus.PENDING);
    await expect(
      service.transition(id, ApplicationStatus.REJECTED, admin(), { overrideReason: '   ' }),
    ).rejects.toMatchObject({ response: { code: 'OVERRIDE_REASON_REQUIRED' } });

    const app = await prismaClient.application.findUnique({ where: { id } });
    expect(app!.status).toBe(ApplicationStatus.PENDING);
    expect(
      await prismaClient.applicationTimelineEntry.count({ where: { applicationId: id } }),
    ).toBe(0);
  });

  gatedIt('same-state → 422 ILLEGAL_TRANSITION even for admin', async () => {
    const id = await makeApp(ApplicationStatus.SHORTLISTED);
    await expect(
      service.transition(id, ApplicationStatus.SHORTLISTED, admin(), { overrideReason: 'x' }),
    ).rejects.toMatchObject({ response: { code: 'ILLEGAL_TRANSITION' } });
  });

  gatedIt(
    'candidate notification carries NO overrideReason, but the timeline row stores it',
    async () => {
      const id = await makeApp(ApplicationStatus.PENDING);
      await service.transition(id, ApplicationStatus.SHORTLISTED, admin(), {
        overrideReason: 'manual correction',
      });

      const notif = await prismaClient.notification.findFirst({
        where: { userId: CANDIDATE_USER_ID },
      });
      expect(JSON.stringify(notif!.data)).not.toContain('manual correction');

      const timeline = await prismaClient.applicationTimelineEntry.findFirst({
        where: { applicationId: id },
      });
      expect(timeline!.overrideReason).toBe('manual correction');
    },
  );
});

// ── The one-WhatsApp guard ────────────────────────────────────────────────────
describe('StatusService — one-WhatsApp guard', () => {
  gatedIt('PENDING→SELECTED enqueues exactly one WhatsApp + sets selectedNotifiedAt', async () => {
    const id = await makeApp(ApplicationStatus.PENDING);
    await service.transition(id, ApplicationStatus.SELECTED, employer());

    expect(enqueuedChannels().filter((c) => c === 'whatsapp')).toHaveLength(1);
    const app = await prismaClient.application.findUnique({ where: { id } });
    expect(app!.selectedNotifiedAt).not.toBeNull();
  });

  gatedIt(
    're-entry (admin SELECTED→REJECTED→SELECTED) sends email+in-app, ZERO new WhatsApp, guard unchanged',
    async () => {
      const id = await makeApp(ApplicationStatus.PENDING);
      await service.transition(id, ApplicationStatus.SELECTED, employer()); // first entry: WhatsApp fires
      const firstGuard = (await prismaClient.application.findUnique({ where: { id } }))!
        .selectedNotifiedAt;
      expect(firstGuard).not.toBeNull();

      queueAdd.mockClear();
      await service.transition(id, ApplicationStatus.REJECTED, admin(), {
        overrideReason: 'reopen flow',
      });
      await service.transition(id, ApplicationStatus.SELECTED, admin(), {
        overrideReason: 'reinstated',
      });

      // Re-entry: no WhatsApp at all across the two admin moves.
      expect(enqueuedChannels().filter((c) => c === 'whatsapp')).toHaveLength(0);
      expect(enqueuedChannels().filter((c) => c === 'email').length).toBeGreaterThan(0);

      const app = await prismaClient.application.findUnique({ where: { id } });
      expect(app!.selectedNotifiedAt!.getTime()).toBe(firstGuard!.getTime()); // unchanged from first set
    },
  );

  gatedIt(
    'concurrent PENDING→SELECTED race: one 200 + one 422, one timeline row, one WhatsApp, guard set once',
    async () => {
      const id = await makeApp(ApplicationStatus.PENDING);

      const results = await Promise.allSettled([
        service.transition(id, ApplicationStatus.SELECTED, employer()),
        service.transition(id, ApplicationStatus.SELECTED, employer()),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({ response: { code: 'ILLEGAL_TRANSITION' } });

      expect(
        await prismaClient.applicationTimelineEntry.count({ where: { applicationId: id } }),
      ).toBe(1);
      expect(enqueuedChannels().filter((c) => c === 'whatsapp')).toHaveLength(1);
      const app = await prismaClient.application.findUnique({ where: { id } });
      expect(app!.selectedNotifiedAt).not.toBeNull();
    },
  );
});

// ── Scoping, archived, rollback ───────────────────────────────────────────────
describe('StatusService — scoping / archived / rollback', () => {
  gatedIt("employer on ANOTHER company's job → 404, row untouched", async () => {
    const id = await makeApp(ApplicationStatus.PENDING);
    await expect(
      service.transition(id, ApplicationStatus.SHORTLISTED, employer('some-other-company')),
    ).rejects.toBeInstanceOf(NotFoundException);

    const app = await prismaClient.application.findUnique({ where: { id } });
    expect(app!.status).toBe(ApplicationStatus.PENDING);
    expect(
      await prismaClient.applicationTimelineEntry.count({ where: { applicationId: id } }),
    ).toBe(0);
  });

  gatedIt('archived application → 422 for both actors', async () => {
    // One archived app: the archivedAt guard fires for BOTH actors (checked under
    // the lock, before the matrix). A second app would violate (jobId, candidateId).
    const id = await makeApp(ApplicationStatus.PENDING, { archivedAt: new Date() });
    await expect(
      service.transition(id, ApplicationStatus.SHORTLISTED, employer()),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.transition(id, ApplicationStatus.SHORTLISTED, admin(), { overrideReason: 'x' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  gatedIt(
    'rollback: audit throws inside the tx → NOTHING persists, NO notification enqueued',
    async () => {
      const id = await makeApp(ApplicationStatus.PENDING);

      const throwingAudit = {
        logInTransaction: jest.fn().mockRejectedValue(new Error('audit boom')),
      } as unknown as AuditService;
      const jobsStub = {
        getJobForApplication: async () => ({ companyId, title: 'Mason' }),
      } as unknown as JobsService;
      const brittle = new StatusService(
        prismaSvc,
        jobsStub,
        candidateRead,
        notificationService,
        throwingAudit,
        eventEmitter,
      );

      await expect(brittle.transition(id, ApplicationStatus.SELECTED, employer())).rejects.toThrow(
        'audit boom',
      );

      // Status write rolled back, no timeline, no notification (post-commit never ran).
      const app = await prismaClient.application.findUnique({ where: { id } });
      expect(app!.status).toBe(ApplicationStatus.PENDING);
      expect(app!.selectedNotifiedAt).toBeNull();
      expect(
        await prismaClient.applicationTimelineEntry.count({ where: { applicationId: id } }),
      ).toBe(0);
      expect(await prismaClient.notification.count({ where: { userId: CANDIDATE_USER_ID } })).toBe(
        0,
      );
      expect(queueAdd).not.toHaveBeenCalled();
    },
  );
});
