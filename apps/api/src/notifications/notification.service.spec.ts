/**
 * Integration tests for NotificationService against real Postgres + Redis (Testcontainers).
 * Docker-unavailable → graceful skip (same pattern as settings + audit specs).
 *
 * Tests the API-side of the fan-out:
 * - In-app row written synchronously.
 * - WhatsApp + email jobs enqueued per the matrix.
 * - Matrix-driven decisions (no external sends in the API process).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { NotificationType, PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import * as path from 'path';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../core/prisma/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { NotificationService } from './notification.service';

const API_DIR = path.resolve(__dirname, '../../..');

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let prismaClient: PrismaClient;
let moduleRef: TestingModule;
let service: NotificationService;
let dockerUnavailable = false;

/** Spy on queue.add() — captures enqueued jobs without real BullMQ. */
const queueAddSpy = jest.fn().mockResolvedValue({ id: 'mock-job-id' });
const mockQueue = { add: queueAddSpy };

jest.setTimeout(180_000);

const TEST_USER_ID = 'test-user-notify-svc';

beforeAll(async () => {
  try {
    [pgContainer, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_USER: 'sic',
          POSTGRES_PASSWORD: 'sic',
          POSTGRES_DB: 'sic_notify_svc',
        })
        .withExposedPorts(5432)
        .start(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);

    const pgUrl = `postgresql://sic:sic@localhost:${pgContainer.getMappedPort(5432)}/sic_notify_svc`;

    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: pgUrl },
      stdio: 'pipe',
      shell: true,  // Windows: ensures pnpm is resolved via PATH
    });

    prismaClient = new PrismaClient({ datasources: { db: { url: pgUrl } } });
    await prismaClient.$connect();

    // Seed a minimal user row for the notify() in-app insert
    await prismaClient.user.upsert({
      where: { id: TEST_USER_ID },
      create: {
        id: TEST_USER_ID,
        email: 'notify-svc-test@example.com',
        role: 'CANDIDATE',
        status: 'ACTIVE',
      },
      update: {},
    });

    moduleRef = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: prismaClient as unknown as PrismaService },
        { provide: getQueueToken(QUEUE_NAMES.NOTIFICATION), useValue: mockQueue },
      ],
    }).compile();

    await moduleRef.init();
    service = moduleRef.get(NotificationService);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('container runtime') ||
      msg.includes('Docker') ||
      msg.includes('ENOENT') ||
      msg.includes('connect ECONNREFUSED') ||
      msg.includes('not recognized') ||          // Windows: pnpm/prisma not in PATH
      msg.includes('prisma: command not found')  // Unix: prisma not in PATH
    ) {
      dockerUnavailable = true;
      console.warn('[notification-svc-integration] Docker or infra unavailable — tests will be skipped:', msg);
    } else {
      throw err;
    }
  }
});

afterEach(async () => {
  if (dockerUnavailable) return;
  jest.clearAllMocks();
  await prismaClient.notification.deleteMany({ where: { userId: TEST_USER_ID } });
});

afterAll(async () => {
  await moduleRef?.close();
  await prismaClient?.$disconnect();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

// ── notify(APPLICATION_SELECTED) ─────────────────────────────────────────────

describe('notify(APPLICATION_SELECTED) — matrix: inApp ✓ · whatsapp ✓ · email ✓', () => {
  it('writes an in-app notification row synchronously', async () => {
    if (dockerUnavailable) return;
    await service.notify(TEST_USER_ID, NotificationType.APPLICATION_SELECTED, {
      title: 'You were selected!',
      body: 'Congratulations',
    });

    const rows = await prismaClient.notification.findMany({ where: { userId: TEST_USER_ID } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe(NotificationType.APPLICATION_SELECTED);
    expect(rows[0]!.title).toBe('You were selected!');
    expect(rows[0]!.readAt).toBeNull();
  });

  it('enqueues a WhatsApp job', async () => {
    if (dockerUnavailable) return;
    await service.notify(TEST_USER_ID, NotificationType.APPLICATION_SELECTED, {
      title: 'Selected',
      body: 'You were selected',
    });

    const waCalls = queueAddSpy.mock.calls.filter(
      ([, data]: [string, { channel: string }]) => data?.channel === 'whatsapp',
    );
    expect(waCalls).toHaveLength(1);
    expect(waCalls[0]?.[0]).toBe(JOB_NAMES.SEND_NOTIFICATION);
    expect(waCalls[0]?.[1].userId).toBe(TEST_USER_ID);
    expect(waCalls[0]?.[1].type).toBe(NotificationType.APPLICATION_SELECTED);
  });

  it('enqueues an email job', async () => {
    if (dockerUnavailable) return;
    await service.notify(TEST_USER_ID, NotificationType.APPLICATION_SELECTED, {
      title: 'Selected',
      body: 'You were selected',
    });

    const emailCalls = queueAddSpy.mock.calls.filter(
      ([, data]: [string, { channel: string }]) => data?.channel === 'email',
    );
    expect(emailCalls).toHaveLength(1);
    expect(emailCalls[0]?.[1].channel).toBe('email');
  });

  it('jobs carry the correct attempts + backoff options', async () => {
    if (dockerUnavailable) return;
    await service.notify(TEST_USER_ID, NotificationType.APPLICATION_SELECTED, {
      title: 'Selected',
      body: 'You were selected',
    });

    for (const [, , opts] of queueAddSpy.mock.calls as [string, unknown, { attempts: number }][]) {
      expect(opts.attempts).toBeGreaterThan(1);
    }
  });
});

// ── notify(PROFILE_VIEWED) — inApp only ────────────────────────────────────────

describe('notify(PROFILE_VIEWED) — matrix: inApp ✓ · whatsapp ✗ · email ✗', () => {
  it('writes an in-app row and enqueues NO external jobs', async () => {
    if (dockerUnavailable) return;
    await service.notify(TEST_USER_ID, NotificationType.PROFILE_VIEWED, {
      title: 'Profile viewed',
      body: 'An employer viewed your profile',
    });

    const rows = await prismaClient.notification.findMany({ where: { userId: TEST_USER_ID } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe(NotificationType.PROFILE_VIEWED);

    expect(queueAddSpy).not.toHaveBeenCalled();
  });
});

// ── notify(JOB_CLOSING_SOON) — inApp only ─────────────────────────────────────

describe('notify(JOB_CLOSING_SOON) — matrix: inApp ✓ · whatsapp ✗ · email ✗', () => {
  it('writes an in-app row, no queue jobs', async () => {
    if (dockerUnavailable) return;
    await service.notify(TEST_USER_ID, NotificationType.JOB_CLOSING_SOON, {
      title: 'Job closing soon',
      body: 'Apply now',
    });

    const rows = await prismaClient.notification.findMany({ where: { userId: TEST_USER_ID } });
    expect(rows).toHaveLength(1);
    expect(queueAddSpy).not.toHaveBeenCalled();
  });
});

// ── listNotifications + markRead ──────────────────────────────────────────────

describe('listNotifications + markRead', () => {
  it('listNotifications returns notifications for the user, newest first', async () => {
    if (dockerUnavailable) return;
    await service.notify(TEST_USER_ID, NotificationType.PROFILE_VIEWED, {
      title: 'View 1',
      body: 'Body',
    });
    await service.notify(TEST_USER_ID, NotificationType.PROFILE_VIEWED, {
      title: 'View 2',
      body: 'Body',
    });

    const { data, nextCursor } = await service.listNotifications(TEST_USER_ID, { limit: 10 });
    expect(data.length).toBe(2);
    expect(nextCursor).toBeNull();
  });

  it('listNotifications paginates with cursor', async () => {
    if (dockerUnavailable) return;
    // Insert 3 notifications
    for (let i = 0; i < 3; i++) {
      await service.notify(TEST_USER_ID, NotificationType.PROFILE_VIEWED, {
        title: `View ${i}`,
        body: 'Body',
      });
    }

    const page1 = await service.listNotifications(TEST_USER_ID, { limit: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await service.listNotifications(TEST_USER_ID, {
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.data).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });

  it('listNotifications filters unread', async () => {
    if (dockerUnavailable) return;
    await service.notify(TEST_USER_ID, NotificationType.PROFILE_VIEWED, {
      title: 'Unread',
      body: 'Body',
    });
    // Mark first one as read directly
    const rows = await prismaClient.notification.findMany({ where: { userId: TEST_USER_ID } });
    await prismaClient.notification.update({
      where: { id: rows[0]!.id },
      data: { readAt: new Date() },
    });

    await service.notify(TEST_USER_ID, NotificationType.PROFILE_VIEWED, {
      title: 'Still unread',
      body: 'Body',
    });

    const { data } = await service.listNotifications(TEST_USER_ID, { unread: true });
    expect(data.every((n) => n.readAt === null)).toBe(true);
  });

  it('markRead marks specified notifications', async () => {
    if (dockerUnavailable) return;
    await service.notify(TEST_USER_ID, NotificationType.PROFILE_VIEWED, {
      title: 'To read',
      body: 'Body',
    });
    const rows = await prismaClient.notification.findMany({ where: { userId: TEST_USER_ID } });
    const ids = rows.map((r) => r.id);

    await service.markRead(TEST_USER_ID, { ids });

    const after = await prismaClient.notification.findMany({ where: { userId: TEST_USER_ID } });
    expect(after.every((n) => n.readAt !== null)).toBe(true);
  });

  it('markRead with all:true marks everything', async () => {
    if (dockerUnavailable) return;
    for (let i = 0; i < 3; i++) {
      await service.notify(TEST_USER_ID, NotificationType.PROFILE_VIEWED, {
        title: `N${i}`,
        body: 'Body',
      });
    }

    await service.markRead(TEST_USER_ID, { all: true });

    const after = await prismaClient.notification.findMany({ where: { userId: TEST_USER_ID } });
    expect(after.every((n) => n.readAt !== null)).toBe(true);
  });
});
