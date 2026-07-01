/**
 * Integration tests for AuditService against a real Postgres instance (Testcontainers).
 * When Docker is unavailable, the suite passes with all tests skipped.
 *
 * Critical tests:
 * - log() is fire-and-safe: never throws into the caller on DB failure.
 * - logInTransaction(): row commits with the transaction and is absent on rollback.
 * - BigInt PK: round-trips correctly; no JSON serialization crash.
 */
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditStatus, PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import * as path from 'path';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from './audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES } from './audit.types';

const API_DIR = path.resolve(__dirname, '../../..');

let pgContainer: StartedTestContainer;
let prismaClient: PrismaClient;
let moduleRef: TestingModule;
let service: AuditService;
let dockerUnavailable = false;

jest.setTimeout(180_000);

beforeAll(async () => {
  try {
    pgContainer = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_USER: 'sic',
        POSTGRES_PASSWORD: 'sic',
        POSTGRES_DB: 'sic_test_audit',
      })
      .withExposedPorts(5432)
      .start();

    const pgUrl = `postgresql://sic:sic@localhost:${pgContainer.getMappedPort(5432)}/sic_test_audit`;

    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: pgUrl },
      stdio: 'pipe',
      shell: true,
    });

    prismaClient = new PrismaClient({ datasources: { db: { url: pgUrl } } });
    await prismaClient.$connect();

    moduleRef = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: prismaClient as unknown as PrismaService },
      ],
    }).compile();

    await moduleRef.init();
    service = moduleRef.get(AuditService);
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
      console.warn('[audit-integration] Docker or infra unavailable — tests will be skipped:', msg);
    } else {
      throw err;
    }
  }
});

afterEach(async () => {
  if (dockerUnavailable) return;
  jest.restoreAllMocks();
  await prismaClient.auditLog.deleteMany({});
});

afterAll(async () => {
  await moduleRef?.close();
  await prismaClient?.$disconnect();
  await pgContainer?.stop();
});

// ── log(): basic insert ──────────────────────────────────────────────────────

describe('AuditService.log — basic insert', () => {
  it('inserts a row with the correct module/action/status', async () => {
    if (dockerUnavailable) return;
    await service.log({
      action: AUDIT_ACTIONS.SETTINGS_UPDATE,
      module: AUDIT_MODULES.SETTINGS,
      status: AuditStatus.SUCCESS,
      actorUserId: 'actor-uuid',
      meta: { key: 'jobs.auto_archive_days' },
    });

    const rows = await service.query({ action: AUDIT_ACTIONS.SETTINGS_UPDATE, limit: 1 });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.module).toBe(AUDIT_MODULES.SETTINGS);
    expect(row.action).toBe(AUDIT_ACTIONS.SETTINGS_UPDATE);
    expect(row.status).toBe(AuditStatus.SUCCESS);
    expect(row.actorUserId).toBe('actor-uuid');
  });

  it('persists redacted meta — PII keys are masked', async () => {
    if (dockerUnavailable) return;
    await service.log({
      action: AUDIT_ACTIONS.SETTINGS_UPDATE,
      module: AUDIT_MODULES.SETTINGS,
      status: AuditStatus.SUCCESS,
      meta: { password: 'should-be-gone', key: 'worker_protection.accommodation_required' },
    });

    const rows = await service.query({ action: AUDIT_ACTIONS.SETTINGS_UPDATE, limit: 1 });
    const meta = rows[0]!.meta as Record<string, unknown>;
    expect(meta.password).toBe('[REDACTED]');
    expect(meta.key).toBe('worker_protection.accommodation_required');
  });
});

// ── log(): fire-and-safe ─────────────────────────────────────────────────────

describe('AuditService.log — fire-and-safe', () => {
  it('does NOT throw when the insert fails; emits app-logger error', async () => {
    if (dockerUnavailable) return;
    jest
      .spyOn(prismaClient.auditLog, 'create')
      .mockRejectedValueOnce(new Error('simulated DB failure'));

    const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    await expect(
      service.log({
        action: AUDIT_ACTIONS.DOCUMENT_CHANGED,
        module: AUDIT_MODULES.CANDIDATE,
        status: AuditStatus.ERROR,
      }),
    ).resolves.toBeUndefined();

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('audit insert failed'),
      expect.objectContaining({ module: AUDIT_MODULES.CANDIDATE, action: AUDIT_ACTIONS.DOCUMENT_CHANGED }),
    );
  });

  it('logger error message contains no PII — only module/action/status', async () => {
    if (dockerUnavailable) return;
    jest
      .spyOn(prismaClient.auditLog, 'create')
      .mockRejectedValueOnce(new Error('simulated DB failure'));

    const capturedMessages: string[] = [];
    const capturedMeta: unknown[] = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((msg: unknown, meta: unknown) => {
      capturedMessages.push(String(msg));
      capturedMeta.push(meta);
    });

    await service.log({
      action: AUDIT_ACTIONS.SETTINGS_UPDATE,
      module: AUDIT_MODULES.SETTINGS,
      status: AuditStatus.FAILED,
      actorUserId: 'super-1',
      meta: { phone: '+919876543210', secret: 'top-secret' },
    });

    // The logger args must not contain PII from meta
    const loggedText = JSON.stringify([capturedMessages, capturedMeta]);
    expect(loggedText).not.toContain('+919876543210');
    expect(loggedText).not.toContain('top-secret');
  });
});

// ── logInTransaction(): atomic audit ────────────────────────────────────────

describe('AuditService.logInTransaction — atomic', () => {
  it('audit row commits when the surrounding transaction commits', async () => {
    if (dockerUnavailable) return;
    let insertedId: bigint | undefined;

    await prismaClient.$transaction(async (tx) => {
      await service.logInTransaction(tx, {
        action: AUDIT_ACTIONS.SETTINGS_UPDATE,
        module: AUDIT_MODULES.SETTINGS,
        status: AuditStatus.SUCCESS,
        meta: { txTest: 'commit' },
      });
      const rows = await tx.auditLog.findMany({ orderBy: { id: 'desc' }, take: 1 });
      insertedId = rows[0]?.id;
    });

    const found = await prismaClient.auditLog.findUnique({ where: { id: insertedId! } });
    expect(found).not.toBeNull();
    expect(found!.module).toBe(AUDIT_MODULES.SETTINGS);
  });

  it('audit row is absent when the surrounding transaction rolls back', async () => {
    if (dockerUnavailable) return;
    const uniqueTag = `rollback-${Date.now()}`;

    await expect(
      prismaClient.$transaction(async (tx) => {
        await service.logInTransaction(tx, {
          action: AUDIT_ACTIONS.JOB_PUBLISH_BLOCKED,
          module: AUDIT_MODULES.JOBS,
          status: AuditStatus.BLOCKED,
          meta: { tag: uniqueTag },
        });
        throw new Error('intentional rollback');
      }),
    ).rejects.toThrow('intentional rollback');

    const rows = await prismaClient.auditLog.findMany({
      where: {
        action: AUDIT_ACTIONS.JOB_PUBLISH_BLOCKED,
        meta: { path: ['tag'], equals: uniqueTag },
      },
    });
    expect(rows).toHaveLength(0);
  });

  it('propagates insert failure so the caller transaction rolls back', async () => {
    if (dockerUnavailable) return;
    let txAttempted = false;

    jest
      .spyOn(prismaClient.auditLog, 'create')
      .mockRejectedValueOnce(new Error('simulated insert failure'));

    await expect(
      prismaClient.$transaction(async (tx) => {
        txAttempted = true;
        await service.logInTransaction(tx, {
          action: AUDIT_ACTIONS.APPLICATION_ADMIN_OVERRIDE,
          module: AUDIT_MODULES.JOBS,
          status: AuditStatus.SUCCESS,
        });
      }),
    ).rejects.toThrow('simulated insert failure');

    expect(txAttempted).toBe(true);
  });
});

// ── BigInt PK ────────────────────────────────────────────────────────────────

describe('AuditService — BigInt PK serialization', () => {
  it('id is bigint type and round-trips through String() without crash', async () => {
    if (dockerUnavailable) return;
    await service.log({
      action: AUDIT_ACTIONS.SETTINGS_UPDATE,
      module: AUDIT_MODULES.SETTINGS,
      status: AuditStatus.SUCCESS,
    });

    const rows = await service.query({ action: AUDIT_ACTIONS.SETTINGS_UPDATE, limit: 1 });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    expect(typeof row.id).toBe('bigint');
    const idStr = String(row.id);
    expect(idStr).toMatch(/^\d+$/);
  });

  it('BigInt id serialises to string via JSON replacer without crash', async () => {
    if (dockerUnavailable) return;
    await service.log({
      action: AUDIT_ACTIONS.SETTINGS_UPDATE,
      module: AUDIT_MODULES.SETTINGS,
      status: AuditStatus.SUCCESS,
    });

    const rows = await service.query({ action: AUDIT_ACTIONS.SETTINGS_UPDATE, limit: 1 });
    const row = rows[0]!;

    // The canonical safe pattern: BigInt → string in JSON output
    expect(() => {
      JSON.stringify(row, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    }).not.toThrow();
  });
});

// ── query(): basic filter ────────────────────────────────────────────────────

describe('AuditService.query — internal filter', () => {
  it('filters by module', async () => {
    if (dockerUnavailable) return;
    await service.log({
      action: AUDIT_ACTIONS.SETTINGS_UPDATE,
      module: AUDIT_MODULES.SETTINGS,
      status: AuditStatus.SUCCESS,
    });
    await service.log({
      action: AUDIT_ACTIONS.DOCUMENT_CHANGED,
      module: AUDIT_MODULES.CANDIDATE,
      status: AuditStatus.SUCCESS,
    });

    const settingsRows = await service.query({ module: AUDIT_MODULES.SETTINGS });
    expect(settingsRows.every((r) => r.module === AUDIT_MODULES.SETTINGS)).toBe(true);
  });

  it('filters by actorUserId', async () => {
    if (dockerUnavailable) return;
    await service.log({
      action: AUDIT_ACTIONS.SETTINGS_UPDATE,
      module: AUDIT_MODULES.SETTINGS,
      status: AuditStatus.SUCCESS,
      actorUserId: 'actor-a',
    });
    await service.log({
      action: AUDIT_ACTIONS.SETTINGS_UPDATE,
      module: AUDIT_MODULES.SETTINGS,
      status: AuditStatus.SUCCESS,
      actorUserId: 'actor-b',
    });

    const rows = await service.query({ actorUserId: 'actor-a' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorUserId).toBe('actor-a');
  });
});
