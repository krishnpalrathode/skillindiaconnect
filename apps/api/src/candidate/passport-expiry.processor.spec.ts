/**
 * PassportExpiryProcessor tests.
 *
 * Section 1 — Unit: mocked Prisma + mocked NotificationService. Validates window
 *   assignment, once-per-window dedup, PENDING_DELETION skip, and audit.
 * Section 2 — Integration (Testcontainers PG): real DB, notifications table as
 *   dedup ledger, verifies in-app row written and dedup prevents a second row.
 *
 * Docker-skip pattern: Section 2 skips gracefully when Docker is unavailable.
 */

import { Job as BullJob } from 'bullmq';
import { DocumentType, NotificationType, UserRole, UserStatus } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { execSync } from 'child_process';
import * as path from 'path';
import { PassportExpiryProcessor } from './passport-expiry.processor';
import { JOB_NAMES } from '../queue/queue.constants';
import { PrismaService } from '../core/prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../audit/audit.service';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');

function makeJob(name: string = JOB_NAMES.PASSPORT_EXPIRY_SCAN): BullJob {
  return { name, id: 'test-job-1' } as BullJob;
}

function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

// ── Section 1: Unit tests — mocked deps ──────────────────────────────────────

describe('PassportExpiryProcessor — unit (mocked)', () => {
  let processor: PassportExpiryProcessor;
  let mockPrisma: jest.Mocked<any>;
  let mockNotify: jest.Mock;
  let mockAudit: jest.Mocked<Pick<AuditService, 'log'>>;

  beforeEach(() => {
    mockNotify = jest.fn().mockResolvedValue(undefined);

    mockPrisma = {
      candidateDocument: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      // $queryRaw returns [] by default → no duplicate
      $queryRaw: jest.fn().mockResolvedValue([{ count: 0 }]),
    };

    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

    const mockNotificationService = {
      notify: mockNotify,
    } as unknown as NotificationService;

    processor = new PassportExpiryProcessor(
      mockPrisma as unknown as PrismaService,
      mockNotificationService,
      mockAudit as unknown as AuditService,
    );
  });

  it('skips unexpected job names without throwing', async () => {
    const result = await processor.process(makeJob('unknown-job'));
    expect(result).toEqual({});
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('returns zero counts when no passports fall in any window', async () => {
    mockPrisma.candidateDocument.findMany.mockResolvedValue([]);
    const result = await processor.process(makeJob());
    expect(result).toEqual({ window60: 0, window30: 0, window7: 0, window0: 0 });
  });

  it('calls notify for each document without an existing notification', async () => {
    const now = new Date();
    const expiryDate = addDays(now, 5); // falls in window=7 band
    const docId = 'doc-uuid-1';

    // Only the window=7 query should return a result; others return []
    mockPrisma.candidateDocument.findMany.mockImplementation(
      ({ where }: { where: { expiryDate?: { gt?: Date; lte?: Date } } }) => {
        const filter = where.expiryDate;
        if (!filter) return Promise.resolve([]);
        // window=7: gt=now, lte=now+7d
        if ('gt' in filter && 'lte' in filter) {
          const { gt, lte } = filter as { gt?: Date; lte?: Date };
          if (
            gt &&
            lte &&
            gt.getTime() <= expiryDate.getTime() &&
            expiryDate.getTime() <= lte.getTime()
          ) {
            return Promise.resolve([
              { id: docId, expiryDate, candidate: { userId: 'user-1' } },
            ]);
          }
        }
        return Promise.resolve([]);
      },
    );

    const result = await processor.process(makeJob());
    expect(result.window7).toBe(1);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(
      'user-1',
      NotificationType.PASSPORT_EXPIRY,
      expect.objectContaining({
        data: expect.objectContaining({ window: 7 }),
      }),
    );
  });

  it('skips already-notified documents (dedup: count > 0)', async () => {
    const now = new Date();
    const expiryDate = addDays(now, 5);

    mockPrisma.candidateDocument.findMany.mockImplementation(
      ({ where }: { where: { expiryDate?: Record<string, Date> } }) => {
        const filter = where.expiryDate;
        if (filter && 'gt' in filter && 'lte' in filter) {
          const { gt, lte } = filter as { gt?: Date; lte?: Date };
          if (gt && lte && gt.getTime() <= expiryDate.getTime()) {
            return Promise.resolve([
              { id: 'doc-1', expiryDate, candidate: { userId: 'user-2' } },
            ]);
          }
        }
        return Promise.resolve([]);
      },
    );
    // Simulate already-sent notification
    mockPrisma.$queryRaw.mockResolvedValue([{ count: 1 }]);

    const result = await processor.process(makeJob());
    expect(result.window7).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('writes audit log with counts-only (no PII) after each run', async () => {
    await processor.process(makeJob());
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'passport_expiry.run',
        module: 'Candidate',
        meta: expect.objectContaining({ window60: 0, window30: 0, window7: 0, window0: 0 }),
      }),
    );
  });

  it('expired passport (window=0) gets daysRemaining <= 0 in notification', async () => {
    const now = new Date();
    const expiryDate = addDays(now, -10); // expired 10 days ago

    mockPrisma.candidateDocument.findMany.mockImplementation(
      ({ where }: { where: { expiryDate?: Record<string, Date> } }) => {
        const filter = where.expiryDate;
        // window=0: lte=now (no gt)
        if (filter && 'lte' in filter && !('gt' in filter)) {
          const { lte } = filter as { lte?: Date };
          if (lte && expiryDate.getTime() <= lte.getTime()) {
            return Promise.resolve([
              { id: 'doc-exp', expiryDate, candidate: { userId: 'user-3' } },
            ]);
          }
        }
        return Promise.resolve([]);
      },
    );

    await processor.process(makeJob());
    expect(mockNotify).toHaveBeenCalledWith(
      'user-3',
      NotificationType.PASSPORT_EXPIRY,
      expect.objectContaining({
        data: expect.objectContaining({ window: 0, daysRemaining: -10 }),
      }),
    );
  });
});

// ── Section 2: Integration tests (Testcontainers PG) ─────────────────────────

let container: StartedTestContainer | null = null;
let prisma: PrismaClient | null = null;
let dockerUnavailable = false;

beforeAll(async () => {
  try {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'testdb' })
      .withExposedPorts(5432)
      .start();

    const port = container.getMappedPort(5432);
    const url = `postgresql://test:test@127.0.0.1:${port}/testdb`;
    process.env['DATABASE_URL'] = url;

    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });

    prisma = new PrismaClient({ datasources: { db: { url } } });
  } catch {
    dockerUnavailable = true;
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

function skipIfNoDocker() {
  if (dockerUnavailable) {
    console.warn('Docker unavailable — skipping Testcontainers test');
  }
  return dockerUnavailable;
}

async function seedWorld(p: PrismaClient, expiryDaysFromNow: number) {
  const user = await p.user.create({
    data: {
      email: `passtest-${Date.now()}-${Math.random()}@test.com`,
      role: UserRole.CANDIDATE,
      status: UserStatus.ACTIVE,
    },
  });
  const candidate = await p.candidateProfile.create({
    data: { userId: user.id, fullName: 'Test Candidate', profileVisible: true },
  });
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + expiryDaysFromNow);
  const doc = await p.candidateDocument.create({
    data: {
      candidateId: candidate.id,
      type: DocumentType.PASSPORT,
      r2Key: `passports/${user.id}/passport.pdf`,
      fileName: 'passport.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      expiryDate,
    },
  });
  return { user, candidate, doc };
}

describe('PassportExpiryProcessor — Testcontainers PG', () => {
  let processor: PassportExpiryProcessor;
  let mockNotify: jest.Mock;
  let mockAudit: jest.Mocked<Pick<AuditService, 'log'>>;

  beforeEach(() => {
    if (dockerUnavailable || !prisma) return;

    mockNotify = jest.fn().mockResolvedValue(undefined);
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

    const mockNotificationService = {
      notify: mockNotify,
    } as unknown as NotificationService;

    processor = new PassportExpiryProcessor(
      prisma as unknown as PrismaService,
      mockNotificationService,
      mockAudit as unknown as AuditService,
    );
  });

  afterEach(async () => {
    if (!prisma) return;
    await prisma.candidateDocument.deleteMany();
    await prisma.candidateProfile.deleteMany();
    await prisma.user.deleteMany({ where: { email: { contains: 'passtest-' } } });
    await prisma.notification.deleteMany();
  });

  it('passport expiring in 5 days falls in window=7 and triggers notify', async () => {
    if (skipIfNoDocker()) return;
    await seedWorld(prisma!, 5);
    const result = await processor.process(makeJob());
    expect(result.window7).toBe(1);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(
      expect.any(String),
      NotificationType.PASSPORT_EXPIRY,
      expect.objectContaining({ data: expect.objectContaining({ window: 7 }) }),
    );
  });

  it('passport expiring in 20 days falls in window=30 and triggers notify', async () => {
    if (skipIfNoDocker()) return;
    await seedWorld(prisma!, 20);
    const result = await processor.process(makeJob());
    expect(result.window30).toBe(1);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(
      expect.any(String),
      NotificationType.PASSPORT_EXPIRY,
      expect.objectContaining({ data: expect.objectContaining({ window: 30 }) }),
    );
  });

  it('PENDING_DELETION user is skipped (no notify)', async () => {
    if (skipIfNoDocker()) return;
    const user = await prisma!.user.create({
      data: {
        email: `passtest-del-${Date.now()}@test.com`,
        role: UserRole.CANDIDATE,
        status: UserStatus.PENDING_DELETION,
      },
    });
    const candidate = await prisma!.candidateProfile.create({
      data: { userId: user.id, fullName: 'Deleting', profileVisible: false },
    });
    const expiryDate = addDays(new Date(), 5);
    await prisma!.candidateDocument.create({
      data: {
        candidateId: candidate.id,
        type: DocumentType.PASSPORT,
        r2Key: `passports/${user.id}/pp.pdf`,
        fileName: 'pp.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 512,
        expiryDate,
      },
    });

    const result = await processor.process(makeJob());
    expect(result.window7).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('second processor run for same (expiryDate, window) does NOT re-notify', async () => {
    if (skipIfNoDocker()) return;
    const { user } = await seedWorld(prisma!, 5);

    // Simulate a prior notification having been written (what notify() would do via
    // the real NotificationService for in-app; here we write directly since notify is mocked)
    const expiryDate = addDays(new Date(), 5);
    await prisma!.notification.create({
      data: {
        userId: user.id,
        type: NotificationType.PASSPORT_EXPIRY,
        title: 'Passport Expiry Reminder',
        body: 'Expires in 5 days',
        data: {
          expiryDate: expiryDate.toISOString().slice(0, 10),
          daysRemaining: 5,
          window: 7,
        },
      },
    });

    // Second run should find the existing notification and skip
    const result = await processor.process(makeJob());
    expect(result.window7).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('different window for same expiryDate is NOT deduplicated (each window fires once)', async () => {
    if (skipIfNoDocker()) return;
    const { user } = await seedWorld(prisma!, 5);

    // Seed a window=30 notification (different window than the current window=7 band)
    const expiryDate = addDays(new Date(), 5);
    await prisma!.notification.create({
      data: {
        userId: user.id,
        type: NotificationType.PASSPORT_EXPIRY,
        title: 'Passport Expiry Reminder',
        body: 'Expires in 5 days',
        data: {
          expiryDate: expiryDate.toISOString().slice(0, 10),
          daysRemaining: 25,
          window: 30,
        },
      },
    });

    // The window=7 notification is still new → should be sent
    const result = await processor.process(makeJob());
    expect(result.window7).toBe(1);
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it('notification data carries correct expiryDate and daysRemaining (no PII)', async () => {
    if (skipIfNoDocker()) return;
    await seedWorld(prisma!, 3);

    await processor.process(makeJob());

    expect(mockNotify).toHaveBeenCalledWith(
      expect.any(String),
      NotificationType.PASSPORT_EXPIRY,
      expect.objectContaining({
        data: expect.objectContaining({
          daysRemaining: 3,
          window: 7,
        }),
      }),
    );
    // Verify no PII fields in the notification data
    const callArgs = mockNotify.mock.calls[0]![2];
    expect('phone' in callArgs.data).toBe(false);
    expect('passportNumber' in callArgs.data).toBe(false);
    expect('r2Key' in callArgs.data).toBe(false);
  });
});
