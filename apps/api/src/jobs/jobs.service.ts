import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JobMarket, JobStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { EmployerService } from '../employer/employer.service';
import { ApplicationsAggregateService } from '../applications/applications-aggregate.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../settings/settings.keys';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { JOB_EVENTS, JobPublishedPayload, JobPausedPayload } from './jobs.events';
import { JobData, JobLifecycleService } from './job-lifecycle.service';
import { PublishGuardService } from './publish-guard.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { ListJobsDto } from './dto/list-jobs.dto';
import { isCountryValidForMarket } from './job-countries';
import { buildOrderBy, resolveSort } from '../core/sorting';
import { OTHER_CATEGORY_SLUG } from '../core/job-categories';

/**
 * Sanitizes job description HTML to strip dangerous tags/attributes (XSS defense).
 * Removes script/iframe/object blocks and on* event attributes.
 * Intended as defense-in-depth — the client should also sanitize with DOMPurify.
 */
function sanitizeDescription(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '')
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    .replace(/href\s*=\s*["']?\s*javascript:[^"'\s>]*/gi, '');
}

/**
 * Sortable columns for the employer My Jobs table (whitelisted).
 *
 * Field names deliberately match the ones ListJobsDto already accepted
 * (`createdAt`, `publishedAt`, `title`) so existing callers and bookmarks keep
 * working; `status` is new. This replaces the old local SORT_FIELD_MAP, which
 * did the same job without the `id` tiebreaker.
 */
export const MY_JOBS_SORT = {
  title: 'title',
  status: 'status',
  createdAt: 'createdAt',
  publishedAt: 'publishedAt',
} as const;

export const MY_JOBS_SORT_DEFAULT = 'createdAt:desc';

/** Narrow projection of a job for the S4 apply flow (see getJobForApplication). */
export interface JobForApplication {
  id: string;
  status: JobStatus;
  market: JobMarket;
  categoryId: string;
  experienceRequiredYears: number | null;
  companyId: string;
  title: string;
}

/** Public-safe job subset for the candidate applications list (see getJobSubsets). */
export interface JobSubset {
  id: string;
  title: string;
  companyName: string;
  location: string;
  market: JobMarket;
}

/** My-Jobs row = the job plus its live applicant count (S4-B3). */
export type JobWithApplicantCount = JobData & { applicantCount: number };

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employerService: EmployerService,
    private readonly settingsService: SettingsService,
    private readonly auditService: AuditService,
    private readonly publishGuard: PublishGuardService,
    private readonly lifecycle: JobLifecycleService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => ApplicationsAggregateService))
    private readonly applicationsAggregate: ApplicationsAggregateService,
  ) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(dto: CreateJobDto, userId: string, actorRole: UserRole): Promise<JobData> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);

    const job = await this.createJobRecord(company.id, dto);

    await this.auditService.log({
      actorUserId: userId,
      actorRole,
      action: AUDIT_ACTIONS.JOB_CREATED,
      module: AUDIT_MODULES.JOBS,
      targetType: 'Job',
      targetId: job.id,
      status: AuditStatus.SUCCESS,
      meta: { companyId: company.id },
    });

    return job;
  }

  /**
   * S6b-B2: on-behalf creation (decision 4, minimal). SAME insert path as the
   * employer's own create — same validation shape, same DB-assigned humanId,
   * same generated searchVector — plus `postedByAdminId`. The job BELONGS to
   * the target company; the admin is only recorded as its poster. Always lands
   * as DRAFT here; publishing is a separate, fully-gated step in the admin
   * service (an admin cannot launder a job past the publish gates).
   */
  async createOnBehalf(
    companyId: string,
    dto: CreateJobDto,
    adminUserId: string,
    actorRole: UserRole,
  ): Promise<JobData> {
    const job = await this.createJobRecord(companyId, dto, adminUserId);

    await this.auditService.log({
      actorUserId: adminUserId,
      actorRole,
      action: AUDIT_ACTIONS.JOB_CREATED_ONBEHALF,
      module: AUDIT_MODULES.JOBS,
      targetType: 'Job',
      targetId: job.id,
      status: AuditStatus.SUCCESS,
      meta: { companyId, postedByAdminId: adminUserId },
    });

    return job;
  }

  /** The single job-insert path — employer create and admin on-behalf share it. */
  private async createJobRecord(
    companyId: string,
    dto: CreateJobDto,
    postedByAdminId?: string,
  ): Promise<JobData> {
    // Server-side enforcement (never trust the UI): India for LOCAL, a GCC state
    // for GULF. The DTO already guarantees `country` is one of the known names.
    if (!isCountryValidForMarket(dto.country, dto.market)) {
      throw new BadRequestException({
        code: 'COUNTRY_MARKET_MISMATCH',
        detail: `Country "${dto.country}" is not valid for a ${dto.market} job.`,
      });
    }

    const categoryOther = await this.resolveCategoryOther(dto.categoryId, dto.categoryOther);

    return this.prisma.job.create({
      data: {
        companyId,
        title: dto.title,
        employmentType: dto.employmentType,
        market: dto.market,
        country: dto.country,
        location: dto.location,
        description: sanitizeDescription(dto.description),
        categoryId: dto.categoryId,
        categoryOther,
        requirements: dto.requirements,
        experienceRequiredYears: dto.experienceRequiredYears,
        salaryMin: dto.salaryMin,
        salaryMax: dto.salaryMax,
        currency: dto.currency,
        accommodation: dto.accommodation,
        healthInsurance: dto.healthInsurance,
        transportation: dto.transportation,
        foodAllowance: dto.foodAllowance,
        airTicketArrival: dto.airTicketArrival,
        airTicketDeparture: dto.airTicketDeparture,
        otherAllowance: dto.otherAllowance,
        hoursPerDay: dto.hoursPerDay,
        daysPerWeek: dto.daysPerWeek,
        overtime: dto.overtime,
        overtimeRateSubunits: dto.overtimeRateSubunits,
        contractPeriodMonths: dto.contractPeriodMonths,
        vacancies: dto.vacancies,
        genderPreference: dto.genderPreference,
        isFeatured: dto.isFeatured ?? false,
        isUrgent: dto.isUrgent ?? false,
        status: JobStatus.DRAFT,
        ...(postedByAdminId !== undefined && { postedByAdminId }),
        // humanId: DB-assigned via job_human_seq — NEVER set here
        // searchVector: DB-generated tsvector — NEVER set here
      },
    });
  }

  /**
   * Pairs `categoryId` with `categoryOther` and returns what should be stored.
   *
   * Both directions are errors, and both are worth catching: free text with a
   * real trade selected means the UI sent a stale draft value that would then
   * outrank the picked category everywhere it is displayed, and the `other`
   * category with no text means a job filed under "Other" that says nothing
   * about what the work is. The category ROW has to be read to know which case
   * this is, which is why it cannot be a class-validator rule.
   */
  private async resolveCategoryOther(
    categoryId: string,
    categoryOther: string | undefined,
  ): Promise<string | null> {
    const category = await this.prisma.jobCategory.findUnique({
      where: { id: categoryId },
      select: { slug: true },
    });
    if (!category) {
      throw new BadRequestException({
        code: 'JOB_CATEGORY_NOT_FOUND',
        detail: 'The selected job category does not exist.',
      });
    }

    const trimmed = categoryOther?.trim();

    if (category.slug !== OTHER_CATEGORY_SLUG) {
      if (trimmed) {
        throw new BadRequestException({
          code: 'CATEGORY_OTHER_NOT_ALLOWED',
          detail: 'A custom category is only accepted when the category is "Other".',
        });
      }
      return null;
    }

    if (!trimmed) {
      throw new BadRequestException({
        code: 'CATEGORY_OTHER_REQUIRED',
        detail: 'Enter the job category when choosing "Other".',
      });
    }
    return trimmed;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findOne(jobId: string, userId: string): Promise<JobData> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
    await this.assertOwnership(job.companyId, userId);
    return job;
  }

  async list(
    userId: string,
    dto: ListJobsDto,
  ): Promise<{
    data: JobWithApplicantCount[];
    meta: { page: number; pageSize: number; total: number; totalPages: number; sort: string };
  }> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);
    // Shared resolver: same whitelist as before, but it appends the `id`
    // tiebreaker. Sorting by `title` alone is not a total order, so two jobs
    // sharing a title could repeat or vanish across offset pages.
    const sort = resolveSort(dto.sort, MY_JOBS_SORT, MY_JOBS_SORT_DEFAULT);

    const where = {
      companyId: company.id,
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.search !== undefined &&
        dto.search.length > 0 && {
          title: { contains: dto.search, mode: 'insensitive' as const },
        }),
    };

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const [data, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: buildOrderBy(sort, MY_JOBS_SORT),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.job.count({ where }),
    ]);

    // S4-B3: live applicant counts for the page — ONE grouped query for all rows
    // (never N per-row queries). Counts come through the applications aggregate.
    const counts = await this.applicationsAggregate.countsPerJob(data.map((j) => j.id));
    const enriched: JobWithApplicantCount[] = data.map((j) => ({
      ...j,
      applicantCount: counts.get(j.id)?.applications ?? 0,
    }));

    return {
      data: enriched,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize), sort: sort.applied },
    };
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  /**
   * Update editable fields on a job.
   *
   * Editing an ACTIVE job does NOT re-enter review at S2 — it stays ACTIVE.
   * The distinction between "material" and "cosmetic" edits is deferred to a
   * future content-moderation policy. For now, keep it simple.
   */
  async update(
    jobId: string,
    dto: UpdateJobDto,
    userId: string,
    actorRole: UserRole,
  ): Promise<JobData> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
    await this.assertOwnership(job.companyId, userId);

    // Keep country consistent with market when either is edited. Old rows with a
    // null country are left alone unless the edit sets one.
    const nextMarket = dto.market ?? job.market;
    const nextCountry = dto.country ?? job.country;
    if (
      nextCountry != null &&
      (dto.market !== undefined || dto.country !== undefined) &&
      !isCountryValidForMarket(nextCountry, nextMarket)
    ) {
      throw new BadRequestException({
        code: 'COUNTRY_MARKET_MISMATCH',
        detail: `Country "${nextCountry}" is not valid for a ${nextMarket} job.`,
      });
    }

    // Re-pair category and free text whenever EITHER moves. Editing only the
    // category (Other → Electrician) has to clear the stale free text, and
    // editing only the text has to be checked against the category already
    // stored — so the resolve runs on the merged pair, not on the patch.
    const categoryTouched = dto.categoryId !== undefined || dto.categoryOther !== undefined;
    const categoryOther = categoryTouched
      ? await this.resolveCategoryOther(dto.categoryId ?? job.categoryId, dto.categoryOther)
      : undefined;

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        ...(categoryTouched && { categoryOther }),
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.employmentType !== undefined && { employmentType: dto.employmentType }),
        ...(dto.market !== undefined && { market: dto.market }),
        ...(dto.country !== undefined && { country: dto.country }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.description !== undefined && {
          description: sanitizeDescription(dto.description),
        }),
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        ...(dto.requirements !== undefined && { requirements: dto.requirements }),
        ...(dto.experienceRequiredYears !== undefined && {
          experienceRequiredYears: dto.experienceRequiredYears,
        }),
        ...(dto.salaryMin !== undefined && { salaryMin: dto.salaryMin }),
        ...(dto.salaryMax !== undefined && { salaryMax: dto.salaryMax }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.accommodation !== undefined && { accommodation: dto.accommodation }),
        ...(dto.healthInsurance !== undefined && { healthInsurance: dto.healthInsurance }),
        ...(dto.transportation !== undefined && { transportation: dto.transportation }),
        ...(dto.foodAllowance !== undefined && { foodAllowance: dto.foodAllowance }),
        ...(dto.airTicketArrival !== undefined && { airTicketArrival: dto.airTicketArrival }),
        ...(dto.airTicketDeparture !== undefined && { airTicketDeparture: dto.airTicketDeparture }),
        ...(dto.otherAllowance !== undefined && { otherAllowance: dto.otherAllowance }),
        ...(dto.hoursPerDay !== undefined && { hoursPerDay: dto.hoursPerDay }),
        ...(dto.daysPerWeek !== undefined && { daysPerWeek: dto.daysPerWeek }),
        ...(dto.overtime !== undefined && { overtime: dto.overtime }),
        ...(dto.overtimeRateSubunits !== undefined && {
          overtimeRateSubunits: dto.overtimeRateSubunits,
        }),
        ...(dto.contractPeriodMonths !== undefined && {
          contractPeriodMonths: dto.contractPeriodMonths,
        }),
        ...(dto.vacancies !== undefined && { vacancies: dto.vacancies }),
        ...(dto.genderPreference !== undefined && { genderPreference: dto.genderPreference }),
        ...(dto.isFeatured !== undefined && { isFeatured: dto.isFeatured }),
        ...(dto.isUrgent !== undefined && { isUrgent: dto.isUrgent }),
      },
    });

    await this.auditService.log({
      actorUserId: userId,
      actorRole,
      action: AUDIT_ACTIONS.JOB_UPDATED,
      module: AUDIT_MODULES.JOBS,
      targetType: 'Job',
      targetId: jobId,
      status: AuditStatus.SUCCESS,
      meta: { companyId: job.companyId },
    });

    return updated;
  }

  // ── Publish ────────────────────────────────────────────────────────────────

  async publish(jobId: string, userId: string, actorRole: UserRole): Promise<JobData> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
    await this.assertOwnership(job.companyId, userId);

    // Ownership confirmed: job is DRAFT (only DRAFT→PENDING_REVIEW/ACTIVE is valid)
    this.lifecycle.assertLegalTransition(job.status, JobStatus.ACTIVE);

    const company = await this.employerService.getCompanyForEmployerUser(userId);

    // Full publish gate (throws if any check fails — order enforced in guard)
    await this.publishGuard.assertPublishable(job, company, userId, actorRole);

    // Determine target status based on the approval setting
    const requireAdminApproval = await this.settingsService.get(
      SETTING_KEYS.REQUIRE_ADMIN_APPROVAL,
    );
    const autoArchiveDays = await this.settingsService.get(SETTING_KEYS.AUTO_ARCHIVE_DAYS);

    const targetStatus = requireAdminApproval ? JobStatus.PENDING_REVIEW : JobStatus.ACTIVE;

    const now = new Date();
    const autoArchiveAt =
      targetStatus === JobStatus.ACTIVE
        ? new Date(now.getTime() + autoArchiveDays * 24 * 60 * 60 * 1000)
        : null;

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: targetStatus,
        ...(targetStatus === JobStatus.ACTIVE && {
          publishedAt: now,
          autoArchiveAt,
        }),
      },
    });

    await this.auditService.log({
      actorUserId: userId,
      actorRole,
      action: AUDIT_ACTIONS.JOB_PUBLISHED,
      module: AUDIT_MODULES.JOBS,
      targetType: 'Job',
      targetId: jobId,
      status: AuditStatus.SUCCESS,
      meta: { companyId: company.id, targetStatus },
    });

    if (targetStatus === JobStatus.ACTIVE) {
      const payload: JobPublishedPayload = { jobId, companyId: company.id };
      this.eventEmitter.emit(JOB_EVENTS.PUBLISHED, payload);
    }

    return updated;
  }

  /**
   * S6b-B2: the post-publish ACTIVATION bookkeeping, shared by the two ADMIN
   * paths (review-approve and on-behalf publish). Mirrors publish()'s ACTIVE
   * branch exactly: publishedAt, autoArchiveAt from Settings, and the
   * `job.published` event (→ S2-B6 search-cache invalidation).
   *
   * DOES NOT RUN THE GATES — the caller must have passed
   * PublishGuardService.assertPublishable first; this method is only the
   * bookkeeping after a gate-approved decision. It also does not audit: the
   * admin paths write their own review/on-behalf audit actions.
   */
  async activateJob(
    jobId: string,
    extraData: Prisma.JobUncheckedUpdateInput = {},
  ): Promise<JobData> {
    const autoArchiveDays = await this.settingsService.get(SETTING_KEYS.AUTO_ARCHIVE_DAYS);
    const now = new Date();
    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.ACTIVE,
        publishedAt: now,
        autoArchiveAt: new Date(now.getTime() + autoArchiveDays * 24 * 60 * 60 * 1000),
        ...extraData,
      },
    });

    const payload: JobPublishedPayload = { jobId, companyId: updated.companyId };
    this.eventEmitter.emit(JOB_EVENTS.PUBLISHED, payload);

    return updated;
  }

  // ── Lifecycle delegates ────────────────────────────────────────────────────

  async pause(jobId: string, userId: string, actorRole: UserRole): Promise<JobData> {
    await this.assertOwnershipByJobId(jobId, userId);
    const company = await this.employerService.getCompanyForEmployerUser(userId);
    return this.lifecycle.pause(jobId, company.id, userId, actorRole);
  }

  async resume(jobId: string, userId: string, actorRole: UserRole): Promise<JobData> {
    await this.assertOwnershipByJobId(jobId, userId);
    const company = await this.employerService.getCompanyForEmployerUser(userId);
    return this.lifecycle.resume(jobId, company.id, userId, actorRole);
  }

  async archive(jobId: string, userId: string, actorRole: UserRole): Promise<JobData> {
    await this.assertOwnershipByJobId(jobId, userId);
    const company = await this.employerService.getCompanyForEmployerUser(userId);
    return this.lifecycle.archive(jobId, company.id, userId, actorRole);
  }

  // ── Duplicate ──────────────────────────────────────────────────────────────

  async duplicate(jobId: string, userId: string, actorRole: UserRole): Promise<JobData> {
    const source = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!source) throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
    await this.assertOwnership(source.companyId, userId);

    const copy = await this.prisma.job.create({
      data: {
        companyId: source.companyId,
        title: source.title,
        employmentType: source.employmentType,
        market: source.market,
        country: source.country,
        location: source.location,
        description: source.description,
        categoryId: source.categoryId,
        requirements: source.requirements,
        experienceRequiredYears: source.experienceRequiredYears,
        salaryMin: source.salaryMin,
        salaryMax: source.salaryMax,
        currency: source.currency,
        accommodation: source.accommodation,
        healthInsurance: source.healthInsurance,
        transportation: source.transportation,
        foodAllowance: source.foodAllowance,
        airTicketArrival: source.airTicketArrival,
        airTicketDeparture: source.airTicketDeparture,
        otherAllowance: source.otherAllowance,
        hoursPerDay: source.hoursPerDay,
        daysPerWeek: source.daysPerWeek,
        overtime: source.overtime,
        overtimeRateSubunits: source.overtimeRateSubunits,
        contractPeriodMonths: source.contractPeriodMonths,
        vacancies: source.vacancies,
        genderPreference: source.genderPreference,
        isFeatured: false,
        isUrgent: false,
        status: JobStatus.DRAFT,
        // humanId: DB-assigned — NEVER copied
        // searchVector: DB-generated — NEVER copied
      },
    });

    await this.auditService.log({
      actorUserId: userId,
      actorRole,
      action: AUDIT_ACTIONS.JOB_DUPLICATED,
      module: AUDIT_MODULES.JOBS,
      targetType: 'Job',
      targetId: copy.id,
      status: AuditStatus.SUCCESS,
      meta: { companyId: source.companyId, sourceJobId: jobId },
    });

    return copy;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * SEC-001 (S8-H2) — a job belonging to ANOTHER company is reported exactly as
   * a job that does not exist: 404 `JOB_NOT_FOUND`.
   *
   * This used to throw 403 `JOB_NOT_OWNED`, which was an enumeration oracle. The
   * two responses differed, so an authenticated employer could walk uuids and
   * partition them into "exists on this platform" (403) vs "does not exist"
   * (404) — leaking the existence, and via `/publish` etc. the lifecycle state,
   * of every competitor's job including unpublished DRAFTS. No data was
   * returned and no write landed, but existence itself is the leak, and the
   * conventions are explicit: "not yours / hidden" is a 404, never a 403.
   *
   * 403 is reserved for "you lack a permission on a resource whose existence is
   * fine to reveal" — an RBAC denial. Ownership failure is not that.
   */
  private async assertOwnership(companyId: string, userId: string): Promise<void> {
    const link = await this.prisma.employerUser.findUnique({ where: { userId } });
    if (!link || link.companyId !== companyId) {
      throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
    }
  }

  private async assertOwnershipByJobId(jobId: string, userId: string): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { companyId: true },
    });
    // Both branches yield the identical 404 — see assertOwnership (SEC-001).
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
    await this.assertOwnership(job.companyId, userId);
  }

  // ── Cross-module seam: ApplicationsModule (S4-B1) ─────────────────────────

  /**
   * Narrow read for the apply flow (S4-B1). The Applications module must NOT
   * query the jobs table directly (module-boundaries.md Rule 4) — it calls this.
   *
   * Returns only what the apply gate + match engine need (status, market,
   * category, required years, companyId for the employer notification), or throws
   * a 404 `JOB_NOT_FOUND` — identical to every other job-not-found path. The
   * status is returned raw; gate 1 decides whether a non-ACTIVE job is applyable.
   */
  async getJobForApplication(jobId: string): Promise<JobForApplication> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        market: true,
        categoryId: true,
        experienceRequiredYears: true,
        companyId: true,
        title: true,
      },
    });
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
    return job;
  }

  /**
   * Batched public-safe job subset for the candidate applications list (S4-B3).
   * Returns ONLY display-safe fields (no internal/employer PII) keyed by jobId.
   * `companyName` is read via the job→company relation (denormalized for display,
   * same precedent as getCompanyJobStats) — the caller never touches jobs/companies.
   */
  async getJobSubsets(jobIds: string[]): Promise<Map<string, JobSubset>> {
    if (jobIds.length === 0) return new Map();
    const rows = await this.prisma.job.findMany({
      where: { id: { in: jobIds } },
      select: {
        id: true,
        title: true,
        location: true,
        market: true,
        company: { select: { name: true } },
      },
    });
    return new Map(
      rows.map((j) => [
        j.id,
        {
          id: j.id,
          title: j.title,
          companyName: j.company.name,
          location: j.location,
          market: j.market,
        },
      ]),
    );
  }

  /**
   * S6a-B1 (admin dashboard): platform-wide job counts keyed by JobStatus. ONE
   * grouped query. PENDING_REVIEW is included and is what feeds the dashboard's
   * `pendingJobReviews` queue depth — the admin module derives it from this map
   * rather than issuing a second count.
   */
  async countByStatus(): Promise<Record<string, number>> {
    const grouped = await this.prisma.job.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    // Zero-filled so the dashboard's fixed tile set never loses a column.
    const counts: Record<string, number> = {
      DRAFT: 0,
      PENDING_REVIEW: 0,
      ACTIVE: 0,
      PAUSED: 0,
      ARCHIVED: 0,
    };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
    }
    return counts;
  }

  // ── Admin analytics reads (Screen 22) ───────────────────────────────────────

  /** Jobs created / published per day — the job-performance chart. */
  async dailyJobSeries(from: Date, to: Date): Promise<JobSeriesRow[]> {
    return this.prisma.$queryRaw<JobSeriesRow[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
             COUNT(*)::int AS created,
             COUNT(*) FILTER (WHERE "publishedAt" IS NOT NULL)::int AS published,
             COUNT(*) FILTER (WHERE status = 'ARCHIVED')::int AS archived
      FROM jobs
      WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY 1 ORDER BY 1`;
  }

  /** Active-job count created in a window — the KPI delta. */
  async countCreatedBetween(from: Date, to: Date): Promise<number> {
    return this.prisma.job.count({ where: { createdAt: { gte: from, lt: to } } });
  }

  /**
   * Best-performing ACTIVE jobs by application volume.
   *
   * `views` is deliberately ABSENT: nothing records a job view, so the column in
   * the reference design would have been a fabricated number. Conversion here is
   * hires ÷ applications, both of which are real rows.
   */
  async topPerformingJobs(limit = 5): Promise<TopJobRow[]> {
    return this.prisma.$queryRaw<TopJobRow[]>`
      SELECT j.title,
             c.name AS "employerName",
             j.status::text AS status,
             COUNT(a.id)::int AS applications,
             COUNT(a.id) FILTER (WHERE a.status = 'SHORTLISTED')::int AS shortlisted,
             COUNT(a.id) FILTER (WHERE a.status = 'SELECTED')::int AS hires
      FROM jobs j
      JOIN companies c ON c.id = j."companyId"
      LEFT JOIN applications a ON a."jobId" = j.id
      WHERE j.status = 'ACTIVE'
      GROUP BY j.id, j.title, c.name, j.status
      ORDER BY applications DESC, j.title ASC
      LIMIT ${limit}`;
  }

  /** All job ids for a company (S4-B3 aggregates scope applications by these). */
  async getJobIdsForCompany(companyId: string): Promise<string[]> {
    const rows = await this.prisma.job.findMany({
      where: { companyId },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  // ── Cross-module seam: EmployerDashboardService (S3-B1) ───────────────────

  /**
   * Narrow read for employer dashboard aggregates.
   * Called by EmployerDashboardService — the Employer module must NOT query
   * the jobs table directly (module-boundaries.md Rule 4).
   * Returns at most 5 recent jobs in the JobCard shape.
   */
  async getCompanyJobStats(companyId: string): Promise<{
    activeJobs: number;
    totalJobViews: number;
    recentJobs: Array<{
      id: string;
      title: string;
      market: string;
      location: string;
      salaryCurrency: string;
      salaryMin: number | null;
      salaryMax: number | null;
      accommodation: boolean;
      healthInsurance: boolean;
      transportation: boolean;
      companyName: string;
      createdAt: string;
      publishedAt: string | null;
      isSaved: null;
    }>;
  }> {
    const [activeJobs, viewsAgg, recentRows] = await Promise.all([
      this.prisma.job.count({ where: { companyId, status: JobStatus.ACTIVE } }),
      this.prisma.job.aggregate({ where: { companyId }, _sum: { viewsCount: true } }),
      this.prisma.job.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { company: { select: { name: true } } },
      }),
    ]);

    return {
      activeJobs,
      totalJobViews: viewsAgg._sum.viewsCount ?? 0,
      recentJobs: recentRows.map((j) => ({
        id: j.id,
        title: j.title,
        market: j.market,
        location: j.location,
        salaryCurrency: j.currency,
        salaryMin: j.salaryMin,
        salaryMax: j.salaryMax,
        accommodation: j.accommodation,
        healthInsurance: j.healthInsurance,
        transportation: j.transportation,
        companyName: j.company.name,
        createdAt: j.createdAt.toISOString(),
        publishedAt: j.publishedAt?.toISOString() ?? null,
        isSaved: null, // employer dashboard context — not a candidate save action
      })),
    };
  }

  /**
   * Pause all ACTIVE jobs for a company (used by the employer.suspended event handler).
   * Reactivation does NOT auto-resume — the employer must manually resume each job.
   */
  async pauseAllActiveJobsForCompany(companyId: string, reason: string): Promise<void> {
    const jobs = await this.prisma.job.findMany({
      where: { companyId, status: JobStatus.ACTIVE },
      select: { id: true },
    });

    if (jobs.length === 0) return;

    await this.prisma.job.updateMany({
      where: { id: { in: jobs.map((j) => j.id) }, status: JobStatus.ACTIVE },
      data: { status: JobStatus.PAUSED, pausedAt: new Date() },
    });

    await Promise.all(
      jobs.map((j) =>
        this.auditService.log({
          action: AUDIT_ACTIONS.JOB_PAUSED,
          module: AUDIT_MODULES.JOBS,
          targetType: 'Job',
          targetId: j.id,
          status: AuditStatus.SUCCESS,
          meta: { companyId, reason },
        }),
      ),
    );

    // Emit JOB_EVENTS.PAUSED per job so SearchCacheSubscriber invalidates the
    // public search cache — otherwise a suspended employer's now-PAUSED jobs
    // keep showing in cached search results until the TTL expires.
    for (const j of jobs) {
      const payload: JobPausedPayload = { jobId: j.id, companyId, reason };
      this.eventEmitter.emit(JOB_EVENTS.PAUSED, payload);
    }
  }
}

export interface JobSeriesRow {
  date: string;
  created: number;
  published: number;
  archived: number;
}

export interface TopJobRow {
  title: string;
  employerName: string;
  status: string;
  applications: number;
  shortlisted: number;
  hires: number;
}
