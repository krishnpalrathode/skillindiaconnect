/**
 * Integration tests for AccountService against real Postgres + Redis containers.
 * Verifies PENDING_DELETION state transition, deletionDueAt, deterministic BullMQ
 * job enqueue, idempotency (409 on second call), and that no purge side-effects
 * occur (user data still present). When Docker is unavailable the suite passes
 * with all tests skipped.
 */
import { ConflictException } from '@nestjs/common';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { execSync } from 'child_process';
import * as path from 'path';
import { AccountService } from './account.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let prisma: PrismaClient;
let purgeQueue: Queue;
let accountService: AccountService;
let dockerUnavailable = false;

// ─── Container lifecycle ──────────────────────────────────────────────────────

beforeAll(async () => {
  try {
    [pgContainer, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_USER: 'sic',
          POSTGRES_PASSWORD: 'sic',
          POSTGRES_DB: 'sic_test',
        })
        .withExposedPorts(5432)
        .start(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);

    const dbUrl = `postgresql://sic:sic@localhost:${pgContainer.getMappedPort(5432)}/sic_test`;
    const redisUrl = `redis://localhost:${redisContainer.getMappedPort(6379)}`;

    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'pipe',
    });

    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    await prisma.$connect();

    purgeQueue = new Queue(QUEUE_NAMES.ACCOUNT_PURGE, { connection: { url: redisUrl } });

    accountService = new AccountService(prisma as unknown as PrismaService, purgeQueue);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('container runtime') ||
      msg.includes('Docker') ||
      msg.includes('ENOENT') ||
      msg.includes('connect ECONNREFUSED')
    ) {
      dockerUnavailable = true;
      console.warn('[integration] Docker unavailable — account tests skipped:', msg);
    } else {
      throw err;
    }
  }
});

afterAll(async () => {
  await purgeQueue?.close();
  await prisma?.$disconnect();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

beforeEach(async () => {
  if (dockerUnavailable) return;
  await prisma.user.deleteMany();
  // Drain the queue so job assertions are isolated.
  await purgeQueue?.drain();
});

// ─── Factories ────────────────────────────────────────────────────────────────

async function makeUser(role: UserRole = UserRole.CANDIDATE) {
  return prisma.user.create({
    data: {
      email: `u-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
      role,
      status: UserStatus.ACTIVE,
    },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AccountService.requestDeletion', () => {
  it('transitions user to PENDING_DELETION', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();

    await accountService.requestDeletion(userId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.status).toBe(UserStatus.PENDING_DELETION);
  });

  it('sets deletionDueAt approximately 30 days from now', async () => {
    if (dockerUnavailable) return;
    const before = Date.now();
    const { id: userId } = await makeUser();

    const result = await accountService.requestDeletion(userId);

    const after = Date.now();
    const expectedMin = before + 29 * 24 * 60 * 60 * 1000;
    const expectedMax = after + 31 * 24 * 60 * 60 * 1000;
    expect(result.deletionDueAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(result.deletionDueAt.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it('persists deletionDueAt in the DB', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();

    const { deletionDueAt } = await accountService.requestDeletion(userId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.deletionDueAt?.toISOString()).toBe(deletionDueAt.toISOString());
  });

  it('enqueues a purge job with deterministic jobId purge:{userId}', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();

    await accountService.requestDeletion(userId);

    const jobs = await purgeQueue.getJobs(['waiting', 'delayed']);
    const purgeJob = jobs.find((j) => j.opts.jobId === `purge-${userId}`);
    expect(purgeJob).toBeDefined();
    expect(purgeJob!.name).toBe(JOB_NAMES.PURGE_CANDIDATE);
    expect(purgeJob!.data).toEqual({ userId });
  });

  it('second call → 409 DELETION_ALREADY_REQUESTED (idempotent-safe)', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();

    await accountService.requestDeletion(userId);

    await expect(accountService.requestDeletion(userId)).rejects.toThrow(ConflictException);
  });

  it('deterministic jobId prevents duplicate queue entries on repeated calls', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();

    await accountService.requestDeletion(userId);

    // Manually reset status so the second call goes through (simulates idempotency check bypass).
    await prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.ACTIVE },
    });

    await accountService.requestDeletion(userId);

    const jobs = await purgeQueue.getJobs(['waiting', 'delayed']);
    const purgeJobs = jobs.filter((j) => j.opts.jobId === `purge-${userId}`);
    // BullMQ dedupes by jobId — only one job should exist.
    expect(purgeJobs.length).toBe(1);
  });

  it('no purge side-effects: user profile and data still present after enqueue', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    await prisma.candidateProfile.create({ data: { userId, fullName: 'Test User' } });

    await accountService.requestDeletion(userId);

    // User and profile still exist — only state changed, purge not executed.
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user).not.toBeNull();
    const profile = await prisma.candidateProfile.findUnique({ where: { userId } });
    expect(profile).not.toBeNull();
    expect(profile!.fullName).toBe('Test User');
  });
});
