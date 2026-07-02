/**
 * Unit tests for JobLifecycleService — the job state machine.
 *
 * All DB calls are mocked. Tests:
 * - Legal transitions succeed; illegal → 409 ILLEGAL_JOB_TRANSITION.
 * - pause / resume / archive update status and emit events.
 * - batchAutoArchive iterates and archives overdue ACTIVE jobs.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { JobStatus, UserRole } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JobLifecycleService } from './job-lifecycle.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JOB_EVENTS } from './jobs.events';

// ── Mocks ─────────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<{
  id: string;
  companyId: string;
  status: JobStatus;
}> = {}) {
  return {
    id: 'job-1',
    companyId: 'co-1',
    status: JobStatus.ACTIVE,
    title: 'Test Job',
    humanId: 'JB-2026-1',
    publishedAt: new Date(),
    pausedAt: null,
    archivedAt: null,
    autoArchiveAt: null,
    ...overrides,
  };
}

function makePrismaMock() {
  return {
    job: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

function makeAuditMock(): jest.Mocked<Pick<AuditService, 'log'>> {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('JobLifecycleService — state machine', () => {
  let service: JobLifecycleService;
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let auditMock: ReturnType<typeof makeAuditMock>;
  let eventEmitter: EventEmitter2;

  beforeEach(() => {
    prismaMock = makePrismaMock();
    auditMock = makeAuditMock();
    eventEmitter = new EventEmitter2();
    service = new JobLifecycleService(
      prismaMock as unknown as PrismaService,
      auditMock as unknown as AuditService,
      eventEmitter,
    );
  });

  // ── assertLegalTransition ─────────────────────────────────────────────────

  describe('assertLegalTransition', () => {
    const legal: Array<[JobStatus, JobStatus]> = [
      [JobStatus.DRAFT, JobStatus.PENDING_REVIEW],
      [JobStatus.DRAFT, JobStatus.ACTIVE],
      [JobStatus.PENDING_REVIEW, JobStatus.ACTIVE],
      [JobStatus.PENDING_REVIEW, JobStatus.ARCHIVED],
      [JobStatus.ACTIVE, JobStatus.PAUSED],
      [JobStatus.ACTIVE, JobStatus.ARCHIVED],
      [JobStatus.PAUSED, JobStatus.ACTIVE],
      [JobStatus.PAUSED, JobStatus.ARCHIVED],
    ];

    test.each(legal)('legal: %s → %s passes', (from, to) => {
      expect(() => service.assertLegalTransition(from, to)).not.toThrow();
    });

    const illegal: Array<[JobStatus, JobStatus]> = [
      [JobStatus.ARCHIVED, JobStatus.ACTIVE],
      [JobStatus.ARCHIVED, JobStatus.DRAFT],
      [JobStatus.ACTIVE, JobStatus.DRAFT],
      [JobStatus.PAUSED, JobStatus.DRAFT],
      [JobStatus.DRAFT, JobStatus.ARCHIVED],
      [JobStatus.DRAFT, JobStatus.PAUSED],
    ];

    test.each(illegal)('illegal: %s → %s throws 409', (from, to) => {
      expect(() => service.assertLegalTransition(from, to)).toThrow(ConflictException);
    });
  });

  // ── pause ─────────────────────────────────────────────────────────────────

  describe('pause', () => {
    it('ACTIVE → PAUSED: updates status, emits job.paused, audits', async () => {
      const job = makeJob({ status: JobStatus.ACTIVE });
      prismaMock.job.findUnique.mockResolvedValue(job);
      const updated = { ...job, status: JobStatus.PAUSED, pausedAt: new Date() };
      prismaMock.job.update.mockResolvedValue(updated);

      const pausedEvents: unknown[] = [];
      eventEmitter.on(JOB_EVENTS.PAUSED, (p) => pausedEvents.push(p));

      const result = await service.pause('job-1', 'co-1', 'user-1', UserRole.EMPLOYER);

      expect(result.status).toBe(JobStatus.PAUSED);
      expect(pausedEvents).toHaveLength(1);
      expect(auditMock.log).toHaveBeenCalledTimes(1);
    });

    it('throws 409 ILLEGAL_JOB_TRANSITION for PAUSED → PAUSED', async () => {
      prismaMock.job.findUnique.mockResolvedValue(makeJob({ status: JobStatus.PAUSED }));
      await expect(
        service.pause('job-1', 'co-1', 'user-1', UserRole.EMPLOYER),
      ).rejects.toThrow(ConflictException);
    });

    it('throws 404 when job not found', async () => {
      prismaMock.job.findUnique.mockResolvedValue(null);
      await expect(
        service.pause('job-missing', 'co-1', 'user-1', UserRole.EMPLOYER),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 when companyId does not match', async () => {
      prismaMock.job.findUnique.mockResolvedValue(makeJob({ companyId: 'other-co' }));
      await expect(
        service.pause('job-1', 'co-1', 'user-1', UserRole.EMPLOYER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── resume ────────────────────────────────────────────────────────────────

  describe('resume', () => {
    it('PAUSED → ACTIVE: clears pausedAt, audits', async () => {
      prismaMock.job.findUnique.mockResolvedValue(makeJob({ status: JobStatus.PAUSED }));
      prismaMock.job.update.mockResolvedValue({ status: JobStatus.ACTIVE, pausedAt: null });

      const result = await service.resume('job-1', 'co-1', 'user-1', UserRole.EMPLOYER);
      expect(result.status).toBe(JobStatus.ACTIVE);
      expect(auditMock.log).toHaveBeenCalled();
    });

    it('throws 409 for ACTIVE → ACTIVE (cannot resume already-active)', async () => {
      prismaMock.job.findUnique.mockResolvedValue(makeJob({ status: JobStatus.ACTIVE }));
      await expect(
        service.resume('job-1', 'co-1', 'user-1', UserRole.EMPLOYER),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── archive ───────────────────────────────────────────────────────────────

  describe('archive', () => {
    it('ACTIVE → ARCHIVED: sets archivedAt, emits job.archived, audits', async () => {
      const job = makeJob({ status: JobStatus.ACTIVE });
      prismaMock.job.findUnique.mockResolvedValue(job);
      prismaMock.job.update.mockResolvedValue({ ...job, status: JobStatus.ARCHIVED });

      const archivedEvents: unknown[] = [];
      eventEmitter.on(JOB_EVENTS.ARCHIVED, (p) => archivedEvents.push(p));

      const result = await service.archive('job-1', 'co-1', 'user-1', UserRole.EMPLOYER);
      expect(result.status).toBe(JobStatus.ARCHIVED);
      expect(archivedEvents).toHaveLength(1);
      expect(auditMock.log).toHaveBeenCalled();
    });

    it('PAUSED → ARCHIVED is legal', async () => {
      prismaMock.job.findUnique.mockResolvedValue(makeJob({ status: JobStatus.PAUSED }));
      prismaMock.job.update.mockResolvedValue({ status: JobStatus.ARCHIVED });
      await expect(
        service.archive('job-1', 'co-1', 'user-1', UserRole.EMPLOYER),
      ).resolves.toBeTruthy();
    });

    it('throws 409 for ARCHIVED → ARCHIVED', async () => {
      prismaMock.job.findUnique.mockResolvedValue(makeJob({ status: JobStatus.ARCHIVED }));
      await expect(
        service.archive('job-1', 'co-1', 'user-1', UserRole.EMPLOYER),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── batchAutoArchive ──────────────────────────────────────────────────────

  describe('batchAutoArchive', () => {
    it('archives all overdue ACTIVE jobs in batches and audits each', async () => {
      const overdueJobs = [
        { id: 'job-a', companyId: 'co-1' },
        { id: 'job-b', companyId: 'co-2' },
      ];
      // First batch returns 2 jobs, second returns 0 (done)
      prismaMock.job.findMany
        .mockResolvedValueOnce(overdueJobs)
        .mockResolvedValueOnce([]);
      prismaMock.job.updateMany.mockResolvedValue({ count: 2 });

      const count = await service.batchAutoArchive(prismaMock as unknown as PrismaService);
      expect(count).toBe(2);
      expect(prismaMock.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: ['job-a', 'job-b'] } }),
          data: expect.objectContaining({ status: JobStatus.ARCHIVED }),
        }),
      );
      expect(auditMock.log).toHaveBeenCalledTimes(2);
    });

    it('returns 0 when no jobs are overdue', async () => {
      prismaMock.job.findMany.mockResolvedValue([]);
      const count = await service.batchAutoArchive(prismaMock as unknown as PrismaService);
      expect(count).toBe(0);
      expect(prismaMock.job.updateMany).not.toHaveBeenCalled();
    });
  });
});
