import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JobStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { EmployerService } from '../employer/employer.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../settings/settings.keys';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { JOB_EVENTS, JobPublishedPayload } from './jobs.events';
import { JobData, JobLifecycleService } from './job-lifecycle.service';
import { PublishGuardService } from './publish-guard.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { ListJobsDto } from './dto/list-jobs.dto';

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

const SORT_FIELD_MAP: Record<string, 'createdAt' | 'publishedAt' | 'title'> = {
  createdAt: 'createdAt',
  publishedAt: 'publishedAt',
  title: 'title',
};

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
  ) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(dto: CreateJobDto, userId: string, actorRole: UserRole): Promise<JobData> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);

    const job = await this.prisma.job.create({
      data: {
        companyId: company.id,
        title: dto.title,
        employmentType: dto.employmentType,
        market: dto.market,
        location: dto.location,
        description: sanitizeDescription(dto.description),
        categoryId: dto.categoryId,
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
        // humanId: DB-assigned via job_human_seq — NEVER set here
        // searchVector: DB-generated tsvector — NEVER set here
      },
    });

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
  ): Promise<{ data: JobData[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);
    const [field, dir] = (dto.sort ?? 'createdAt:desc').split(':');
    const safeField = SORT_FIELD_MAP[field ?? 'createdAt'] ?? 'createdAt';
    const safeDir = dir === 'asc' ? 'asc' : 'desc';

    const where = {
      companyId: company.id,
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.search !== undefined && dto.search.length > 0 && {
        title: { contains: dto.search, mode: 'insensitive' as const },
      }),
    };

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const [data, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: { [safeField]: safeDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.job.count({ where }),
    ]);

    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
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

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.employmentType !== undefined && { employmentType: dto.employmentType }),
        ...(dto.market !== undefined && { market: dto.market }),
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

    const targetStatus = requireAdminApproval
      ? JobStatus.PENDING_REVIEW
      : JobStatus.ACTIVE;

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

  private async assertOwnership(companyId: string, userId: string): Promise<void> {
    const link = await this.prisma.employerUser.findUnique({ where: { userId } });
    if (!link || link.companyId !== companyId) {
      throw new ForbiddenException({ code: 'JOB_NOT_OWNED' });
    }
  }

  private async assertOwnershipByJobId(jobId: string, userId: string): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { companyId: true },
    });
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
    await this.assertOwnership(job.companyId, userId);
  }

  /**
   * Pause all ACTIVE jobs for a company (used by the employer.suspended event handler).
   * Reactivation does NOT auto-resume — the employer must manually resume each job.
   */
  async pauseAllActiveJobsForCompany(
    companyId: string,
    reason: string,
  ): Promise<void> {
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
  }
}
