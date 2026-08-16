import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  forwardRef,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job, JobStatus, NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { NotificationService } from '../notifications/notification.service';
import { EmployerService } from '../employer/employer.service';
import { ApplicationsAggregateService } from '../applications/applications-aggregate.service';
import { JobsService } from './jobs.service';
import { JobData, JobLifecycleService } from './job-lifecycle.service';
import { PublishGuardService } from './publish-guard.service';
import { JOB_EVENTS, JobFlagsChangedPayload } from './jobs.events';
import {
  AdminJobActionDto,
  JobFlagsDto,
  ListAdminJobsDto,
  OnBehalfCreateJobDto,
  ReviewJobDto,
  ADMIN_JOB_SORT,
  ADMIN_JOB_SORT_DEFAULT,
} from './dto/admin-jobs.dto';
import { buildOrderBy, resolveSort } from '../core/sorting';

export interface AdminActor {
  userId: string;
  role: UserRole;
}

/** The contract's AdminJobRow (Screen 26). */
export interface AdminJobRowDto {
  id: string;
  humanId: string;
  title: string;
  companyId: string;
  companyName: string;
  market: string;
  status: JobStatus;
  isFeatured: boolean;
  isUrgent: boolean;
  applicantCount: number;
  views: number;
  moderationReason: string | null;
  publishedAt: string | null;
  createdAt: string;
}

/**
 * The contract's AdminJobDetail (0.8.1): the full job for the Screen 26 review
 * panel — the admin must see the job as candidates would (description, salary,
 * benefits, requirements), for ANY status, which the ACTIVE-only public detail
 * cannot serve. `companyStatus` lets the panel flag a suspended employer
 * BEFORE an approve attempt instead of letting the gate 403 announce it.
 */
export interface AdminJobDetailDto extends AdminJobRowDto {
  location: string;
  description: string;
  categoryId: string;
  salaryMin: number;
  salaryMax: number;
  salaryCurrency: string;
  accommodation: boolean;
  healthInsurance: boolean;
  transportation: boolean;
  foodAllowance: boolean;
  airTicketArrival: boolean;
  airTicketDeparture: boolean;
  otherAllowance: string | null;
  hoursPerDay: number;
  daysPerWeek: number;
  overtime: boolean;
  contractPeriodMonths: number | null;
  requirements: string[];
  experienceRequiredYears: number | null;
  vacancies: number | null;
  genderPreference: string | null;
  companyStatus: string;
  archivedAt: string | null;
}

type JobWithCompanyName = Job & { company: { name: string } };

/**
 * Admin operations over jobs (S6b-B2, Screen 26's data layer). Lives in the
 * Jobs module — the module that OWNS the jobs table (the S2-B4/S4-B2
 * placement precedent; the `admin` module owns no tables).
 *
 * THE CENTRAL SAFETY RULE: approving a PENDING_REVIEW job RE-RUNS
 * PublishGuardService.assertPublishable — the same locked gate order as a
 * direct publish. A job may sit in review for days while the employer gets
 * suspended, a worker-protection rule is switched back ON, or their plan
 * expires; an admin must not be able to click past the platform's safety gate.
 * The same guard runs on on-behalf publishing. This service REUSES S2-B5's
 * guard + lifecycle — it never re-implements a transition or a gate (a second
 * copy of the gate logic in an admin path is exactly how a "small" admin
 * bypass gets born).
 *
 * Admin moderation ignores OWNERSHIP (any employer's job) but not the STATE
 * MACHINE — pause/archive delegate to JobLifecycleService, which 409s illegal
 * transitions and emits the events the S2-B6 search cache listens to.
 */
@Injectable()
export class AdminJobsService {
  private readonly logger = new Logger(AdminJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobsService: JobsService,
    private readonly lifecycle: JobLifecycleService,
    private readonly publishGuard: PublishGuardService,
    private readonly auditService: AuditService,
    private readonly notificationService: NotificationService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => EmployerService))
    private readonly employerService: EmployerService,
    @Inject(forwardRef(() => ApplicationsAggregateService))
    private readonly applicationsAggregate: ApplicationsAggregateService,
  ) {}

  // ── GET /admin/jobs ─────────────────────────────────────────────────────────

  /** ALL statuses — the moderation queue deep-links here with ?status=PENDING_REVIEW. */
  async list(query: ListAdminJobsDto): Promise<{
    data: AdminJobRowDto[];
    meta: { page: number; pageSize: number; total: number; totalPages: number; sort: string };
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sort = resolveSort(query.sort, ADMIN_JOB_SORT, ADMIN_JOB_SORT_DEFAULT);

    const where = {
      ...(query.status !== undefined && { status: query.status }),
      ...(query.employerId !== undefined && { companyId: query.employerId }),
      ...(query.featured !== undefined && { isFeatured: query.featured }),
      ...(query.urgent !== undefined && { isUrgent: query.urgent }),
      ...(query.search !== undefined &&
        query.search.length > 0 && {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' as const } },
            { company: { name: { contains: query.search, mode: 'insensitive' as const } } },
          ],
        }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: buildOrderBy(sort, ADMIN_JOB_SORT),
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { company: { select: { name: true } } },
      }),
      this.prisma.job.count({ where }),
    ]);

    // Batched applicant counts via the S4-B3 aggregate export — never N+1.
    const counts = await this.applicationsAggregate.countsPerJob(rows.map((j) => j.id));
    const data = rows.map((job) => this.toRow(job, counts.get(job.id)?.applications ?? 0));

    return {
      data,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize), sort: sort.applied },
    };
  }

  // ── GET /admin/jobs/{id} — the moderation detail (0.8.1) ───────────────────

  /** The full job (any status) + admin facts + companyStatus for the pre-emptive warning. */
  async getDetail(jobId: string): Promise<AdminJobDetailDto> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { company: { select: { name: true, status: true } } },
    });
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND' });

    const counts = await this.applicationsAggregate.countsPerJob([job.id]);
    return {
      ...this.toRow(job, counts.get(job.id)?.applications ?? 0),
      location: job.location,
      description: job.description,
      categoryId: job.categoryId,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      salaryCurrency: job.currency,
      accommodation: job.accommodation,
      healthInsurance: job.healthInsurance,
      transportation: job.transportation,
      foodAllowance: job.foodAllowance,
      airTicketArrival: job.airTicketArrival,
      airTicketDeparture: job.airTicketDeparture,
      otherAllowance: job.otherAllowance ?? null,
      hoursPerDay: job.hoursPerDay,
      daysPerWeek: job.daysPerWeek,
      overtime: job.overtime,
      contractPeriodMonths: job.contractPeriodMonths ?? null,
      requirements: job.requirements,
      experienceRequiredYears: job.experienceRequiredYears ?? null,
      vacancies: job.vacancies ?? null,
      genderPreference: job.genderPreference ?? null,
      companyStatus: job.company.status,
      archivedAt: job.archivedAt ? job.archivedAt.toISOString() : null,
    };
  }

  // ── POST /admin/jobs/{id}/review — the S2-B5 seam closing ──────────────────

  async review(jobId: string, dto: ReviewJobDto, actor: AdminActor): Promise<AdminJobRowDto> {
    const job = await this.loadJob(jobId);
    if (job.status !== JobStatus.PENDING_REVIEW) {
      throw new ConflictException({
        code: 'JOB_NOT_PENDING_REVIEW',
        meta: { status: job.status },
      });
    }

    const updated =
      dto.decision === 'APPROVE'
        ? await this.approve(job, actor)
        : await this.reject(job, dto.reason, actor);

    return this.toRowWithCount({ ...updated, company: job.company });
  }

  /**
   * APPROVE re-runs the FULL publish gate ladder (approved-employer →
   * protection-rules → quota, the locked order) — the world may have moved
   * while the job sat in review. Gate failures propagate with their own codes
   * (EMPLOYER_NOT_APPROVED / WORKER_PROTECTION_VIOLATION / JOB_QUOTA_EXCEEDED)
   * so the admin learns exactly WHY they cannot approve. On pass, the SAME
   * post-publish work as a direct publish runs (publishedAt, autoArchiveAt,
   * `job.published` → search-cache invalidation).
   */
  private async approve(job: JobWithCompanyName, actor: AdminActor): Promise<JobData> {
    await this.publishGuard.assertPublishable(job, { id: job.companyId }, actor.userId, actor.role);

    const updated = await this.jobsService.activateJob(job.id, {
      moderationReason: null,
      moderatedById: actor.userId,
      moderatedAt: new Date(),
    });

    await this.auditService.log({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.JOB_REVIEW_APPROVED,
      module: AUDIT_MODULES.JOBS,
      targetType: 'Job',
      targetId: job.id,
      status: AuditStatus.SUCCESS,
      meta: { companyId: job.companyId },
    });

    await this.notifyEmployer(job.companyId, NotificationType.JOB_APPROVED, {
      title: 'Your job is now live',
      body: `"${job.title}" (${job.humanId}) was approved and is now visible to candidates.`,
      data: { jobId: job.id, humanId: job.humanId },
    });

    return updated;
  }

  /** REJECT → DRAFT with an employer-visible reason; the employer fixes and resubmits. */
  private async reject(
    job: JobWithCompanyName,
    reason: string | undefined,
    actor: AdminActor,
  ): Promise<JobData> {
    if (!reason?.trim()) {
      throw new UnprocessableEntityException({
        code: 'REVIEW_REASON_REQUIRED',
        detail: 'A reason is required when rejecting a job.',
      });
    }
    const trimmed = reason.trim();

    // The state machine still governs (PENDING_REVIEW → DRAFT is a legal move).
    this.lifecycle.assertLegalTransition(job.status, JobStatus.DRAFT);

    const updated = await this.prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.DRAFT,
        moderationReason: trimmed,
        moderatedById: actor.userId,
        moderatedAt: new Date(),
      },
    });

    await this.auditService.log({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.JOB_REVIEW_REJECTED,
      module: AUDIT_MODULES.JOBS,
      targetType: 'Job',
      targetId: job.id,
      status: AuditStatus.SUCCESS,
      // The reason is employer-visible by design — safe in the trail.
      meta: { companyId: job.companyId, reason: trimmed },
    });

    await this.notifyEmployer(job.companyId, NotificationType.JOB_REJECTED, {
      title: 'Your job needs changes',
      body: `"${job.title}" (${job.humanId}) was not approved: ${trimmed}`,
      data: { jobId: job.id, humanId: job.humanId, reason: trimmed },
    });

    return updated;
  }

  // ── POST /admin/jobs/{id}/pause + /archive ──────────────────────────────────

  /** Any employer's job — but the lifecycle service still enforces the state machine. */
  async pause(jobId: string, dto: AdminJobActionDto, actor: AdminActor): Promise<AdminJobRowDto> {
    const job = await this.loadJob(jobId);
    const updated = await this.lifecycle.pause(
      job.id,
      job.companyId,
      actor.userId,
      actor.role,
      dto.reason,
    );
    return this.toRowWithCount({ ...updated, company: job.company });
  }

  async archive(jobId: string, dto: AdminJobActionDto, actor: AdminActor): Promise<AdminJobRowDto> {
    const job = await this.loadJob(jobId);
    const updated = await this.lifecycle.archive(
      job.id,
      job.companyId,
      actor.userId,
      actor.role,
      dto.reason,
    );
    return this.toRowWithCount({ ...updated, company: job.company });
  }

  // ── PATCH /admin/jobs/{id}/flags (decision 3) ───────────────────────────────

  /**
   * Featured/Urgent are ADMIN-SET ONLY. They drive badges + the ?badge= search
   * filter — both served from the S2-B6 cache, so the flag change EMITS
   * `job.flags.changed`, which the existing SearchCacheSubscriber handles with
   * the same version-bump invalidation as every state change. Flags never
   * touch search RANKING at MVP.
   */
  async setFlags(jobId: string, dto: JobFlagsDto, actor: AdminActor): Promise<AdminJobRowDto> {
    if (dto.featured === undefined && dto.urgent === undefined) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        detail: 'Provide at least one of: featured, urgent.',
      });
    }
    const job = await this.loadJob(jobId);

    const updated = await this.prisma.job.update({
      where: { id: job.id },
      data: {
        ...(dto.featured !== undefined && { isFeatured: dto.featured }),
        ...(dto.urgent !== undefined && { isUrgent: dto.urgent }),
      },
    });

    await this.auditService.log({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.JOB_FLAGS_CHANGED,
      module: AUDIT_MODULES.JOBS,
      targetType: 'Job',
      targetId: job.id,
      status: AuditStatus.SUCCESS,
      meta: {
        companyId: job.companyId,
        from: { featured: job.isFeatured, urgent: job.isUrgent },
        to: { featured: updated.isFeatured, urgent: updated.isUrgent },
      },
    });

    const payload: JobFlagsChangedPayload = {
      jobId: job.id,
      companyId: job.companyId,
      isFeatured: updated.isFeatured,
      isUrgent: updated.isUrgent,
    };
    this.eventEmitter.emit(JOB_EVENTS.FLAGS_CHANGED, payload);

    return this.toRowWithCount({ ...updated, company: job.company });
  }

  // ── POST /admin/jobs — on-behalf posting (decision 4, minimal) ──────────────

  /**
   * Creates via JobsService.createOnBehalf (the same insert path as the
   * employer's own create) with `postedByAdminId`. `publish: true` runs the
   * IDENTICAL gate ladder against the TARGET employer — an admin cannot push a
   * protection-violating or over-quota job live for someone (that is the whole
   * point). The admin IS the reviewer, so a gated-and-passing on-behalf publish
   * goes straight to ACTIVE — routing it into PENDING_REVIEW for the admin to
   * approve their own submission would be circular. Otherwise: DRAFT for the
   * employer to finish. The employer is always notified — a silent job
   * appearing in their dashboard would be confusing.
   */
  async createOnBehalf(dto: OnBehalfCreateJobDto, actor: AdminActor): Promise<JobData> {
    // 404 COMPANY_NOT_FOUND for an unknown target employer.
    const company = await this.employerService.getCompanyById(dto.employerId);

    const publish = dto.publish;
    const createDto = { ...dto };
    delete (createDto as { employerId?: string }).employerId;
    delete (createDto as { publish?: boolean }).publish;
    let job = await this.jobsService.createOnBehalf(
      company.id,
      createDto,
      actor.userId,
      actor.role,
    );

    if (publish === true) {
      await this.publishGuard.assertPublishable(job, { id: company.id }, actor.userId, actor.role);
      job = await this.jobsService.activateJob(job.id);
    }

    await this.notifyEmployer(company.id, NotificationType.JOB_POSTED_ONBEHALF, {
      title: 'A job was posted for your company',
      body:
        publish === true
          ? `"${job.title}" (${job.humanId}) was posted on your behalf by the platform team and is now live.`
          : `"${job.title}" (${job.humanId}) was drafted on your behalf by the platform team. Review and publish it when ready.`,
      data: { jobId: job.id, humanId: job.humanId, status: job.status },
    });

    return job;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async loadJob(jobId: string): Promise<JobWithCompanyName> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { company: { select: { name: true } } },
    });
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
    return job;
  }

  private async toRowWithCount(job: JobWithCompanyName): Promise<AdminJobRowDto> {
    const counts = await this.applicationsAggregate.countsPerJob([job.id]);
    return this.toRow(job, counts.get(job.id)?.applications ?? 0);
  }

  private toRow(job: JobWithCompanyName, applicantCount: number): AdminJobRowDto {
    return {
      id: job.id,
      humanId: job.humanId,
      title: job.title,
      companyId: job.companyId,
      companyName: job.company.name,
      market: job.market,
      status: job.status,
      isFeatured: job.isFeatured,
      isUrgent: job.isUrgent,
      applicantCount,
      views: job.viewsCount,
      moderationReason: job.moderationReason,
      publishedAt: job.publishedAt ? job.publishedAt.toISOString() : null,
      createdAt: job.createdAt.toISOString(),
    };
  }

  /** Notify every employer user of the company (usually one). Best-effort. */
  private async notifyEmployer(
    companyId: string,
    type: NotificationType,
    payload: { title: string; body: string; data?: Record<string, unknown> },
  ): Promise<void> {
    try {
      const users = await this.prisma.employerUser.findMany({
        where: { companyId },
        select: { userId: true },
      });
      for (const u of users) {
        await this.notificationService.notify(u.userId, type, payload);
      }
    } catch (err) {
      // A notification hiccup must not turn a committed moderation into a 500.
      this.logger.error(
        `employer notification (${type}) failed for company ${companyId}`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
