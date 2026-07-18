import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma, UserStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../core/prisma/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

const DELETION_GRACE_DAYS = 30;

/** Callback that writes the caller's audit row inside the status transaction. */
type AuditInTx = (tx: Prisma.TransactionClient) => Promise<void>;

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.ACCOUNT_PURGE) private readonly purgeQueue: Queue,
  ) {}

  /**
   * Transition the user to PENDING_DELETION, schedule deletionDueAt (+30 days),
   * and enqueue a deterministic-jobId purge job.
   *
   * The purge WORKER (R2 deletion, application tombstone, message-PII scrub per
   * the DPDP checklist) is a separate unit — this method only sets state and
   * enqueues; no purge side-effects occur here.
   */
  async requestDeletion(userId: string): Promise<{ deletionDueAt: Date }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status === UserStatus.PENDING_DELETION) {
      throw new ConflictException({ code: 'DELETION_ALREADY_REQUESTED' });
    }
    const deletionDueAt = new Date(Date.now() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.PENDING_DELETION, deletionDueAt },
    });
    // Deterministic jobId prevents duplicate jobs on repeated requests.
    // BullMQ 5.x forbids ':' in custom jobIds — use '-' as separator.
    //
    // S6b-B1 NOTE: this job is IMMEDIATE, so it arrives ~30 days before
    // deletionDueAt; the purge processor checks due-ness at processing time and
    // skips it. The DAILY SWEEP (PurgeCron) is what actually fires the purge at
    // the due date — this enqueue survives as a pipe smoke-check, and its jobId
    // is why the sweep's per-user ids carry a `-due-{day}` suffix (a completed
    // job with the same custom id would swallow any later add via dedupe).
    await this.purgeQueue.add(JOB_NAMES.PURGE_CANDIDATE, { userId }, { jobId: `purge-${userId}` });
    return { deletionDueAt };
  }

  // ── S6b-B1: admin-driven lifecycle transitions ─────────────────────────────
  // The account module owns the users lifecycle columns, so the writes live
  // here; the ADMIN semantics (RBAC, DTOs, audit entries) live in the admin
  // module, which passes its audit write in as a callback so the status change
  // and its audit row commit atomically. Guards run INSIDE the transaction —
  // the read the admin screen made a moment earlier is not the truth.

  /** ACTIVE → SUSPENDED. Also revokes every refresh session: a suspended user
   *  must not keep minting access tokens off a live refresh token (the login
   *  and rotate paths both reject SUSPENDED; this closes the in-flight ones). */
  async suspendUser(userId: string, auditInTx: AuditInTx): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException({ code: 'NOT_FOUND' });
      if (user.purgedAt) throw new ConflictException({ code: 'CANDIDATE_PURGED' });
      // PENDING_DELETION is deliberately NOT suspendable: overwriting that
      // status would make the purge sweep skip the user forever — a suspension
      // must never silently cancel a DPDP erasure.
      if (user.status !== UserStatus.ACTIVE) {
        throw new ConflictException({ code: 'CANDIDATE_NOT_ACTIVE' });
      }
      await tx.user.update({ where: { id: userId }, data: { status: UserStatus.SUSPENDED } });
      await tx.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await auditInTx(tx);
    });
  }

  /** SUSPENDED → ACTIVE. Never resurrects a purged account (409), and never
   *  touches PENDING_DELETION (reactivation is not a deletion-cancel path). */
  async reactivateUser(userId: string, auditInTx: AuditInTx): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException({ code: 'NOT_FOUND' });
      if (user.purgedAt) throw new ConflictException({ code: 'CANDIDATE_PURGED' });
      if (user.status !== UserStatus.SUSPENDED) {
        throw new ConflictException({ code: 'CANDIDATE_NOT_SUSPENDED' });
      }
      await tx.user.update({ where: { id: userId }, data: { status: UserStatus.ACTIVE } });
      await auditInTx(tx);
    });
  }

  /**
   * The ADMIN purge trigger (S6b-B1): immediate, no 30-day grace. Marks the
   * user PENDING_DELETION with deletionDueAt = now, writes the caller's
   * purge-REQUEST audit row atomically, then enqueues the purge job — the
   * WORKER does the destruction, never this method (it touches R2 + many
   * tables). IRREVERSIBLE once the worker runs.
   *
   * jobId `purge-{userId}-admin` — distinct from S1-3's self-request id (which
   * may already exist, completed-as-skip) and from the sweep's per-day ids.
   * Double-clicks dedupe on it; once purged, the API 409s before enqueueing.
   */
  async adminForcePurge(
    userId: string,
    jobContext: { reason: string; actorUserId: string; actorRole: string },
    auditInTx: AuditInTx,
  ): Promise<{ purgeScheduledFor: Date }> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException({ code: 'NOT_FOUND' });
      if (user.purgedAt) throw new ConflictException({ code: 'CANDIDATE_ALREADY_PURGED' });
      await tx.user.update({
        where: { id: userId },
        data: { status: UserStatus.PENDING_DELETION, deletionDueAt: now },
      });
      await auditInTx(tx);
    });
    await this.purgeQueue.add(
      JOB_NAMES.PURGE_CANDIDATE,
      {
        userId,
        trigger: 'admin',
        reason: jobContext.reason,
        actorUserId: jobContext.actorUserId,
        actorRole: jobContext.actorRole,
      },
      {
        jobId: `purge-${userId}-admin`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
      },
    );
    return { purgeScheduledFor: now };
  }
}
