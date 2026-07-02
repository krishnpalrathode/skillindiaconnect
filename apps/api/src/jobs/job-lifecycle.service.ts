import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job, JobStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { JOB_EVENTS, JobPausedPayload, JobArchivedPayload } from './jobs.events';

// searchVector is a DB-generated tsvector (Unsupported type) — Prisma excludes it
// from returned objects automatically. JobData is the canonical return type.
export type JobData = Job;

/**
 * Legal transitions for the job state machine.
 *
 * DRAFT          → PENDING_REVIEW (when approval setting is ON at publish)
 * DRAFT          → ACTIVE         (when approval setting is OFF at publish)
 * PENDING_REVIEW → ACTIVE         (admin approve — S6; entry via publish, resolution via S6)
 * PENDING_REVIEW → ARCHIVED       (admin reject — S6)
 * ACTIVE         ↔ PAUSED
 * ACTIVE/PAUSED  → ARCHIVED
 *
 * Reactivating a paused job (PAUSED→ACTIVE) is a manual employer action;
 * the auto-archive cron only transitions ACTIVE→ARCHIVED (never touches PAUSED).
 */
const LEGAL_TRANSITIONS: Partial<Record<JobStatus, JobStatus[]>> = {
  [JobStatus.DRAFT]: [JobStatus.PENDING_REVIEW, JobStatus.ACTIVE],
  [JobStatus.PENDING_REVIEW]: [JobStatus.ACTIVE, JobStatus.ARCHIVED],
  [JobStatus.ACTIVE]: [JobStatus.PAUSED, JobStatus.ARCHIVED],
  [JobStatus.PAUSED]: [JobStatus.ACTIVE, JobStatus.ARCHIVED],
};

@Injectable()
export class JobLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  assertLegalTransition(currentStatus: JobStatus, toStatus: JobStatus): void {
    const allowed = LEGAL_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new ConflictException({
        code: 'ILLEGAL_JOB_TRANSITION',
        meta: { from: currentStatus, to: toStatus },
      });
    }
  }

  async pause(
    jobId: string,
    companyId: string,
    actorUserId: string,
    actorRole: UserRole,
    reason?: string,
  ): Promise<JobData> {
    await this.loadAndAssert(jobId, companyId, JobStatus.PAUSED);

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.PAUSED, pausedAt: new Date() },
    });

    await this.auditService.log({
      actorUserId,
      actorRole,
      action: AUDIT_ACTIONS.JOB_PAUSED,
      module: AUDIT_MODULES.JOBS,
      targetType: 'Job',
      targetId: jobId,
      status: AuditStatus.SUCCESS,
      meta: { companyId, ...(reason !== undefined && { reason }) },
    });

    const payload: JobPausedPayload = { jobId, companyId, reason };
    this.eventEmitter.emit(JOB_EVENTS.PAUSED, payload);

    return updated;
  }

  async resume(
    jobId: string,
    companyId: string,
    actorUserId: string,
    actorRole: UserRole,
  ): Promise<JobData> {
    await this.loadAndAssert(jobId, companyId, JobStatus.ACTIVE);

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.ACTIVE, pausedAt: null },
    });

    await this.auditService.log({
      actorUserId,
      actorRole,
      action: AUDIT_ACTIONS.JOB_RESUMED,
      module: AUDIT_MODULES.JOBS,
      targetType: 'Job',
      targetId: jobId,
      status: AuditStatus.SUCCESS,
      meta: { companyId },
    });

    return updated;
  }

  async archive(
    jobId: string,
    companyId: string,
    actorUserId: string,
    actorRole: UserRole,
    reason?: string,
  ): Promise<JobData> {
    await this.loadAndAssert(jobId, companyId, JobStatus.ARCHIVED);

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.ARCHIVED, archivedAt: new Date() },
    });

    await this.auditService.log({
      actorUserId,
      actorRole,
      action: AUDIT_ACTIONS.JOB_ARCHIVED,
      module: AUDIT_MODULES.JOBS,
      targetType: 'Job',
      targetId: jobId,
      status: AuditStatus.SUCCESS,
      meta: { companyId, ...(reason !== undefined && { reason }) },
    });

    const payload: JobArchivedPayload = { jobId, companyId, reason };
    this.eventEmitter.emit(JOB_EVENTS.ARCHIVED, payload);

    return updated;
  }

  /**
   * Batch-archive all ACTIVE jobs past their autoArchiveAt deadline.
   * Called by the auto-archive BullMQ processor (never directly from cron).
   */
  async batchAutoArchive(
    prismaOrTx: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const now = new Date();
    const BATCH_SIZE = 100;
    let total = 0;

    while (true) {
      const jobs = await (prismaOrTx as PrismaService).job.findMany({
        where: { status: JobStatus.ACTIVE, autoArchiveAt: { lte: now } },
        select: { id: true, companyId: true },
        take: BATCH_SIZE,
      });
      if (jobs.length === 0) break;

      await (prismaOrTx as PrismaService).job.updateMany({
        where: { id: { in: jobs.map((j) => j.id) } },
        data: { status: JobStatus.ARCHIVED, archivedAt: now },
      });

      // Fire-and-safe audit for each archived job.
      await Promise.all(
        jobs.map((j) =>
          this.auditService.log({
            action: AUDIT_ACTIONS.JOB_AUTO_ARCHIVED,
            module: AUDIT_MODULES.JOBS,
            targetType: 'Job',
            targetId: j.id,
            status: AuditStatus.SUCCESS,
            meta: { companyId: j.companyId, reason: 'auto_archived' },
          }),
        ),
      );

      total += jobs.length;
    }

    return total;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private async loadAndAssert(
    jobId: string,
    companyId: string,
    toStatus: JobStatus,
  ): Promise<Job> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.companyId !== companyId) {
      throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
    }
    this.assertLegalTransition(job.status, toStatus);
    return job;
  }
}
