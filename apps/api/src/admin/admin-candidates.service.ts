import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { ApplicationsAggregateService } from '../applications/applications-aggregate.service';
import { AccountService } from '../account/account.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import {
  toAdminCandidateCard,
  toAdminCandidateDetail,
  type AdminCandidateCardDto,
  type AdminCandidateDetailDto,
} from './mappers/admin-candidate.mapper';
import type { ListAdminCandidatesDto, PurgeCandidateDto } from './dto/admin-candidates.dto';

export interface AdminActor {
  userId: string;
  role: string;
}

/**
 * Admin candidate management (S6b-B1, Screen 25's backend).
 *
 * OWNS NO TABLES (admin-module rule): reads via CandidateReadService and
 * ApplicationsAggregateService; lifecycle writes via AccountService (owner of
 * the users lifecycle columns), which runs guards + the audit row in one
 * transaction. The purge action only MARKS + ENQUEUES (202) — the destruction
 * itself is the worker's job, never inline: it touches R2 and many tables.
 *
 * Suspension mechanism (stated): SUSPENDED users are rejected at login and OTP
 * verification (403 ACCOUNT_SUSPENDED), their refresh sessions are revoked in
 * the suspend transaction, and token rotation re-checks status — so live
 * sessions die within one access-token TTL. Employer surfaces (browse, detail,
 * document keys) select ACTIVE users only, so a suspended candidate vanishes
 * from the pool immediately. No suspension notification template exists in the
 * matrix, so suspend/reactivate are AUDIT-ONLY — stated, not silently claimed.
 */
@Injectable()
export class AdminCandidatesService {
  constructor(
    private readonly candidateRead: CandidateReadService,
    private readonly applicationsAggregate: ApplicationsAggregateService,
    private readonly accountService: AccountService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: ListAdminCandidatesDto): Promise<{
    data: AdminCandidateCardDto[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const { rows, total } = await this.candidateRead.adminListCandidates({
      page,
      pageSize,
      search: query.search,
      status: query.status,
      visibility: query.visibility,
    });
    return {
      data: rows.map(toAdminCandidateCard),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async detail(candidateId: string): Promise<AdminCandidateDetailDto> {
    const source = await this.candidateRead.getAdminCandidateView(candidateId);
    if (!source) throw new NotFoundException({ code: 'NOT_FOUND' });
    const counts = await this.applicationsAggregate.countsForCandidate(candidateId);
    return toAdminCandidateDetail(source, counts.applied);
  }

  async suspend(
    candidateId: string,
    reason: string,
    actor: AdminActor,
  ): Promise<AdminCandidateCardDto> {
    const source = await this.candidateRead.getAdminCandidateView(candidateId);
    if (!source) throw new NotFoundException({ code: 'NOT_FOUND' });

    await this.accountService.suspendUser(source.userId, (tx) =>
      this.auditService.logInTransaction(tx, {
        action: AUDIT_ACTIONS.CANDIDATE_SUSPENDED,
        module: AUDIT_MODULES.CANDIDATE,
        targetType: 'CandidateProfile',
        targetId: candidateId,
        actorUserId: actor.userId,
        actorRole: actor.role as never,
        status: AuditStatus.SUCCESS,
        meta: { reason },
      }),
    );
    return this.refreshedCard(candidateId);
  }

  async reactivate(candidateId: string, actor: AdminActor): Promise<AdminCandidateCardDto> {
    const source = await this.candidateRead.getAdminCandidateView(candidateId);
    if (!source) throw new NotFoundException({ code: 'NOT_FOUND' });
    // The purge is irreversible — a tombstone can never be brought back.
    if (source.user.purgedAt) throw new ConflictException({ code: 'CANDIDATE_PURGED' });

    await this.accountService.reactivateUser(source.userId, (tx) =>
      this.auditService.logInTransaction(tx, {
        action: AUDIT_ACTIONS.CANDIDATE_REACTIVATED,
        module: AUDIT_MODULES.CANDIDATE,
        targetType: 'CandidateProfile',
        targetId: candidateId,
        actorUserId: actor.userId,
        actorRole: actor.role as never,
        status: AuditStatus.SUCCESS,
        meta: {},
      }),
    );
    return this.refreshedCard(candidateId);
  }

  /**
   * The admin purge trigger — IRREVERSIBLE once the worker runs; there is no
   * undo and no restore, by design.
   *
   * Enforcement order: confirm/reason (422 PURGE_NOT_CONFIRMED — a mis-click
   * must never anonymize a human being) → 404 → already-purged 409 → mark +
   * audit the REQUEST transactionally + enqueue (202). The completion audit
   * (`account.purged`, counts only) is the worker's, deliberately separate.
   */
  async requestPurge(
    candidateId: string,
    dto: PurgeCandidateDto,
    actor: AdminActor,
  ): Promise<{ purgeScheduledFor: string }> {
    if (dto.confirm !== true || !dto.reason?.trim()) {
      throw new UnprocessableEntityException({
        code: 'PURGE_NOT_CONFIRMED',
        detail: 'Purge requires an explicit confirmation and a reason.',
      });
    }
    const source = await this.candidateRead.getAdminCandidateView(candidateId);
    if (!source) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (source.user.purgedAt) {
      throw new ConflictException({ code: 'CANDIDATE_ALREADY_PURGED' });
    }

    const reason = dto.reason.trim();
    const { purgeScheduledFor } = await this.accountService.adminForcePurge(
      source.userId,
      { reason, actorUserId: actor.userId, actorRole: actor.role },
      (tx: Prisma.TransactionClient) =>
        this.auditService.logInTransaction(tx, {
          action: AUDIT_ACTIONS.ADMIN_CANDIDATE_PURGE_REQUESTED,
          module: AUDIT_MODULES.CANDIDATE,
          targetType: 'User',
          targetId: source.userId,
          actorUserId: actor.userId,
          actorRole: actor.role as never,
          status: AuditStatus.SUCCESS,
          // Ids and the admin's justification only — NO candidate PII: this row
          // outlives the purge and must not preserve what it destroys.
          meta: { reason, candidateId, trigger: 'admin' },
        }),
    );
    return { purgeScheduledFor: purgeScheduledFor.toISOString() };
  }

  private async refreshedCard(candidateId: string): Promise<AdminCandidateCardDto> {
    const source = await this.candidateRead.getAdminCandidateView(candidateId);
    if (!source) throw new NotFoundException({ code: 'NOT_FOUND' });
    return toAdminCandidateCard(source);
  }
}
