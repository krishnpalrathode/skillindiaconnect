import { Injectable, Logger } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { StorageService } from '../../core/storage/storage.service';
import { AuditService } from '../../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../../audit/audit.types';
import {
  CANDIDATE_PROFILE_ANONYMIZED_FIELDS,
  applicationTombstoneFields,
  REDACTED_EMAIL,
  REDACTED_PHONE,
  userAnonymizedFields,
} from './anonymize.constants';

export type PurgeTrigger = 'self' | 'admin';

/** Counts-only summary — this is ALL the audit row may carry about the purge. */
export interface PurgeCounts {
  objectsDestroyed: number;
  documentsDeleted: number;
  experiencesDeleted: number;
  skillsDeleted: number;
  applicationsTombstoned: number;
  notificationsDeleted: number;
  resumeArtifactsDeleted: number;
  sessionsRevoked: number;
}

export type PurgeResult =
  | { outcome: 'purged'; counts: PurgeCounts }
  | { outcome: 'resumed'; counts: PurgeCounts }
  | { outcome: 'noop_already_purged' }
  | { outcome: 'skipped_no_user' }
  | { outcome: 'skipped_not_candidate' }
  | { outcome: 'skipped_not_pending' } // deletion cancelled/never requested (self path)
  | { outcome: 'skipped_not_due' }; //   grace window still running (self path)

export interface PurgeUserInput {
  userId: string;
  trigger: PurgeTrigger;
  /** Admin-authored justification — audited on the admin path only. */
  reason?: string;
  actorUserId?: string;
  actorRole?: string;
  /**
   * R2 keys captured BEFORE the anonymization transaction nulls the columns
   * that hold them. The CALLER persists this list somewhere that survives a
   * retry (the BullMQ job data) — on a resume after a DB-commit-but-R2-failure,
   * the DB no longer knows the keys; this parameter is the only copy.
   */
  capturedKeys: string[];
  /** Counts persisted by a previous partial run (resume path) — see above. */
  priorCounts?: PurgeCounts | null;
  /** Invoked right after the DB transaction commits, so the caller can persist counts. */
  onDbCommitted?: (counts: PurgeCounts) => Promise<void>;
}

const ZERO_COUNTS: PurgeCounts = {
  objectsDestroyed: 0,
  documentsDeleted: 0,
  experiencesDeleted: 0,
  skillsDeleted: 0,
  applicationsTombstoned: 0,
  notificationsDeleted: 0,
  resumeArtifactsDeleted: 0,
  sessionsRevoked: 0,
};

/**
 * The DPDP erasure implementation (S6b-B1). Executes `anonymize.constants.ts` —
 * the field-by-field map is the spec; this service is only its engine.
 *
 * ORDERED FOR RESUMABILITY, and the order is load-bearing:
 *   1. guards (state re-checked at PROCESSING time, not enqueue time)
 *   2. DB anonymization in ONE transaction (idempotent: `purgedAt` short-circuits)
 *   3. R2 destruction of the pre-captured keys, HEAD-VERIFIED (a delete the
 *      provider claims succeeded but didn't is the worst failure mode here)
 *   4. the `account.purged` audit row — counts only, dedupe-guarded
 * A crash between any two steps is safe: the BullMQ retry re-enters, step 2
 * no-ops, step 3 re-deletes (deleting a gone key succeeds), step 4 writes at
 * most once. This is why the order is DB-then-R2-then-audit.
 *
 * MODULE-BOUNDARY NOTE (Rule 4 deviation, deliberate and reviewed): this
 * service writes to tables owned by Auth (refresh_sessions, otp_challenges),
 * Notifications (notifications, whatsapp/email_messages) and Applications
 * (applications) as well as its own. Erasure is a cross-cutting compliance
 * transaction: splitting it across per-module services would either break the
 * single-transaction guarantee or scatter the erasure spec across the codebase —
 * and the whole point of anonymize.constants.ts is ONE reviewable map.
 * CODEOWNERS second review covers this file for exactly that reason.
 */
@Injectable()
export class PurgeService {
  private readonly logger = new Logger(PurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Collect every R2 object key attached to the user, BEFORE anonymization
   * erases the columns that hold them: photo, intro video, documents, the
   * cached resume render and every generated resume PDF.
   */
  async captureObjectKeys(userId: string): Promise<string[]> {
    const profile = await this.prisma.candidateProfile.findUnique({
      where: { userId },
      select: {
        photoKey: true,
        videoR2Key: true,
        documents: { select: { r2Key: true } },
        resume: {
          select: { lastRenderKey: true, generations: { select: { r2Key: true } } },
        },
      },
    });
    if (!profile) return [];
    const keys = new Set<string>();
    if (profile.photoKey) keys.add(profile.photoKey);
    if (profile.videoR2Key) keys.add(profile.videoR2Key);
    for (const d of profile.documents) keys.add(d.r2Key);
    if (profile.resume?.lastRenderKey) keys.add(profile.resume.lastRenderKey);
    for (const g of profile.resume?.generations ?? []) keys.add(g.r2Key);
    return [...keys];
  }

  async purgeUser(input: PurgeUserInput): Promise<PurgeResult> {
    const now = new Date();
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      include: { candidateProfile: { select: { id: true, phone: true } } },
    });

    if (!user) {
      this.logger.warn(`purge: user not found (${input.userId})`); // an id, not PII
      return { outcome: 'skipped_no_user' };
    }
    if (user.role !== UserRole.CANDIDATE) {
      // Employer purge is out of scope: companies are not natural persons under
      // the DPDP Act. The sweep and the API both filter to candidates already.
      this.logger.warn(`purge: user ${input.userId} is not a candidate — skipping`);
      return { outcome: 'skipped_not_candidate' };
    }

    if (user.purgedAt) {
      // The DB work is done. If the completion audit exists too, this is a
      // duplicate/stale job → clean no-op (idempotency). If it does NOT, a
      // previous run crashed between commit and completion → RESUME: finish
      // the R2 destruction (from the caller-persisted keys) and audit once.
      if (await this.completionAudited(input.userId)) {
        return { outcome: 'noop_already_purged' };
      }
      const counts = input.priorCounts ?? { ...ZERO_COUNTS };
      counts.objectsDestroyed = await this.destroyObjects(input.capturedKeys);
      await this.writeCompletionAudit(input, counts, now);
      return { outcome: 'resumed', counts };
    }

    // State is re-checked at PROCESSING time — a queued job for a user who
    // cancelled deletion (status restored / deletionDueAt cleared) must no-op.
    // S1-3's DELETE /account enqueues an IMMEDIATE job 30 days early; this
    // guard is what turns that early arrival into a documented skip (the daily
    // sweep is the real trigger). The ADMIN path is exempt: the API already
    // forced PENDING_DELETION with deletionDueAt = now before enqueueing.
    if (input.trigger === 'self') {
      if (user.status !== UserStatus.PENDING_DELETION || user.deletionDueAt === null) {
        return { outcome: 'skipped_not_pending' };
      }
      if (user.deletionDueAt.getTime() > now.getTime()) {
        return { outcome: 'skipped_not_due' };
      }
    }

    const counts = await this.anonymizeInTransaction(
      user.id,
      user.candidateProfile,
      now,
    );
    await input.onDbCommitted?.(counts);

    counts.objectsDestroyed = await this.destroyObjects(input.capturedKeys);
    await this.writeCompletionAudit(input, counts, now);
    return { outcome: 'purged', counts };
  }

  /** Step 3 of the map — every write in ONE transaction, exactly per the constants. */
  private async anonymizeInTransaction(
    userId: string,
    profile: { id: string; phone: string | null } | null,
    now: Date,
  ): Promise<PurgeCounts> {
    return this.prisma.$transaction(async (tx) => {
      const counts: PurgeCounts = { ...ZERO_COUNTS };

      const sessions = await tx.refreshSession.deleteMany({ where: { userId } });
      counts.sessionsRevoked = sessions.count;

      await tx.otpChallenge.deleteMany({
        where: {
          OR: [{ userId }, ...(profile?.phone ? [{ phone: profile.phone }] : [])],
        },
      });

      const notifications = await tx.notification.deleteMany({ where: { userId } });
      counts.notificationsDeleted = notifications.count;

      // Delivery logs survive with their aggregates; the address columns do not.
      await tx.whatsappMessage.updateMany({
        where: { userId },
        data: { phone: REDACTED_PHONE },
      });
      await tx.emailMessage.updateMany({
        where: { userId },
        data: { toEmail: REDACTED_EMAIL },
      });

      if (profile) {
        const candidateId = profile.id;

        await tx.savedJob.deleteMany({ where: { candidateId } });

        const generations = await tx.resumeGeneration.deleteMany({
          where: { resume: { candidateId } },
        });
        const resumes = await tx.candidateResume.deleteMany({ where: { candidateId } });
        counts.resumeArtifactsDeleted = generations.count + resumes.count;

        const documents = await tx.candidateDocument.deleteMany({ where: { candidateId } });
        counts.documentsDeleted = documents.count;

        const experiences = await tx.workExperience.deleteMany({ where: { candidateId } });
        counts.experiencesDeleted = experiences.count;

        const skills = await tx.candidateSkill.deleteMany({ where: { candidateId } });
        counts.skillsDeleted = skills.count;

        // KEEP the applications — tombstone the link (S4-B3 renders this shape).
        const applications = await tx.application.updateMany({
          where: { candidateId },
          data: applicationTombstoneFields(now),
        });
        counts.applicationsTombstoned = applications.count;

        await tx.candidateProfile.update({
          where: { id: candidateId },
          data: CANDIDATE_PROFILE_ANONYMIZED_FIELDS,
        });
      }

      await tx.user.update({
        where: { id: userId },
        data: userAnonymizedFields(userId, now),
      });

      return counts;
    });
  }

  /**
   * Step 4: destroy the captured R2 objects, then HEAD-verify each one is GONE.
   * We do not trust the SDK's success response — a swallowed provider error
   * would silently leave a passport scan in the bucket while the DB claims
   * erasure. Any surviving object throws, failing the job into a BullMQ retry
   * (safe: the DB step no-ops on re-entry). Messages carry counts, never keys.
   */
  private async destroyObjects(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    await this.storage.deleteObjects(keys);
    let surviving = 0;
    for (const key of keys) {
      const head = await this.storage.headObject(key);
      if (head !== null) surviving += 1;
    }
    if (surviving > 0) {
      throw new Error(
        `purge: ${surviving} of ${keys.length} R2 object(s) still present after delete`,
      );
    }
    return keys.length;
  }

  private async completionAudited(userId: string): Promise<boolean> {
    const existing = await this.prisma.auditLog.count({
      where: { action: AUDIT_ACTIONS.ACCOUNT_PURGED, targetId: userId },
    });
    return existing > 0;
  }

  /**
   * The compliance-evidence row. COUNTS ONLY — no name, phone, email, or object
   * key may appear here: the audit row must not preserve the PII the purge just
   * destroyed. Dedupe-guarded so retries never double-audit. Written via
   * logInTransaction (which THROWS on failure) rather than the fire-and-forget
   * log(): losing this row silently would erase the evidence of erasure.
   */
  private async writeCompletionAudit(
    input: PurgeUserInput,
    counts: PurgeCounts,
    now: Date,
  ): Promise<void> {
    if (await this.completionAudited(input.userId)) return;
    await this.auditService.logInTransaction(this.prisma, {
      action: AUDIT_ACTIONS.ACCOUNT_PURGED,
      module: AUDIT_MODULES.CANDIDATE,
      targetType: 'User',
      targetId: input.userId,
      actorUserId: input.trigger === 'admin' ? input.actorUserId : input.userId,
      ...(input.actorRole ? { actorRole: input.actorRole as never } : {}),
      status: AuditStatus.SUCCESS,
      meta: {
        trigger: input.trigger,
        ...(input.trigger === 'admin' && input.reason ? { reason: input.reason } : {}),
        purgedAt: now.toISOString(),
        ...counts,
      },
    });
  }
}
