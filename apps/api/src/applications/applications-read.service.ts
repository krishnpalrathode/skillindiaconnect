import { Injectable, NotFoundException } from '@nestjs/common';
import { ApplicationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { pageMeta, resolvePaging, type Paginated } from '../core/pagination';
import { JobsService } from '../jobs/jobs.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { StorageService } from '../core/storage/storage.service';
import { toEmployerView } from '../employer/mappers/candidate-employer-view.mapper';
import {
  ApplicationCardDto,
  ApplicationDetailDto,
  toApplicationCard,
  toApplicationDetail,
} from './mappers/application-card.mapper';
import { ApplicantCardDto, toApplicantCard } from './mappers/applicant-card.mapper';
import { ApplicationResponse, toApplicationResponse } from './application.mapper';

export type ApplicantSort = 'match' | 'recent';

export interface AdminApplicationCardDto extends ApplicationResponse {
  candidateName: string | null;
  jobTitle: string | null;
  /** ADMIN CONTEXT ONLY — the most recent corrective-move reason (contract 0.8.1 row). */
  overrideReason: string | null;
}

/**
 * One timeline entry in the ADMIN serialization (contract AdminTimelineEntry,
 * 0.8.1). Unlike the candidate-facing shaped timeline this carries
 * `overrideReason` — the reason exists FOR admins and the audit trail, and
 * this is its only serialization.
 */
export interface AdminTimelineEntryDto {
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  actorRole: string | null;
  isAdminOverride: boolean;
  overrideReason: string | null;
  createdAt: string;
}

export interface AdminApplicationDetailDto extends AdminApplicationCardDto {
  timeline: AdminTimelineEntryDto[];
}

export interface ApplicantCounts {
  pending: number;
  shortlisted: number;
  selected: number;
  rejected: number;
}

@Injectable()
export class ApplicationsReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobsService: JobsService,
    private readonly candidateRead: CandidateReadService,
    private readonly storage: StorageService,
  ) {}

  // ── Candidate: GET /candidates/me/applications ──────────────────────────────

  /** Offset page, newest first (createdAt DESC, id DESC — stable total ordering). */
  async listCandidateApplications(
    candidateId: string,
    opts: { page?: number; pageSize?: number; status?: ApplicationStatus },
  ): Promise<Paginated<ApplicationCardDto>> {
    const { page, pageSize, skip, take } = resolvePaging(opts.page, opts.pageSize);

    const where: Prisma.ApplicationWhereInput = {
      candidateId,
      ...(opts.status && { status: opts.status }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.application.count({ where }),
    ]);

    const jobs = await this.jobsService.getJobSubsets([...new Set(rows.map((a) => a.jobId))]);
    return {
      data: rows.map((a) => toApplicationCard(a, jobs.get(a.jobId))),
      meta: pageMeta(page, pageSize, total),
    };
  }

  /** Candidate detail + shaped timeline. Own-application scoping → 404 otherwise. */
  async getCandidateApplicationDetail(
    candidateId: string,
    applicationId: string,
  ): Promise<ApplicationDetailDto> {
    const app = await this.prisma.application.findFirst({
      where: { id: applicationId, candidateId },
    });
    if (!app) throw new NotFoundException({ code: 'APPLICATION_NOT_FOUND' });

    const [jobs, timeline] = await Promise.all([
      this.jobsService.getJobSubsets([app.jobId]),
      this.prisma.applicationTimelineEntry.findMany({
        where: { applicationId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return toApplicationDetail(app, jobs.get(app.jobId), timeline);
  }

  // ── Employer: GET /jobs/:id/applicants ──────────────────────────────────────

  /**
   * Applicants for a job the caller's company owns (ownership checked by the
   * caller with the resolved companyId). Offset page + match|recent sort +
   * per-status counts. Each card COMPOSES the S3 employer-context subset
   * (privacy inherited).
   */
  async listJobApplicants(
    jobId: string,
    callerCompanyId: string,
    opts: { page?: number; pageSize?: number; status?: ApplicationStatus; sort?: ApplicantSort },
  ): Promise<Paginated<ApplicantCardDto> & { counts: ApplicantCounts }> {
    // Ownership: the job must belong to the caller's company → else 404.
    const job = await this.jobsService.getJobForApplication(jobId);
    if (job.companyId !== callerCompanyId) {
      throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
    }

    const { page: pageNum, pageSize, skip, take } = resolvePaging(opts.page, opts.pageSize);
    const sort: ApplicantSort = opts.sort === 'recent' ? 'recent' : 'match';

    const where: Prisma.ApplicationWhereInput = {
      jobId,
      ...(opts.status && { status: opts.status }),
    };
    const orderBy: Prisma.ApplicationOrderByWithRelationInput[] =
      sort === 'recent'
        ? [{ createdAt: 'desc' }, { id: 'desc' }]
        : [{ matchScore: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }];

    const [rows, total, grouped] = await Promise.all([
      this.prisma.application.findMany({ where, orderBy, skip, take }),
      this.prisma.application.count({ where }),
      this.prisma.application.groupBy({ by: ['status'], where: { jobId }, _count: { _all: true } }),
    ]);

    const page = rows;

    // Batch-resolve candidate subjects (one query) + presign photos in parallel.
    const candidateIds = [...new Set(page.map((a) => a.candidateId).filter((x): x is string => !!x))];
    const sources = await this.candidateRead.getEmployerViewsByIds(candidateIds);
    const photoUrls = new Map<string, string | null>();
    await Promise.all(
      [...sources.values()].map(async (s) => {
        photoUrls.set(s.id, s.photoKey ? await this.storage.presignGet(s.photoKey) : null);
      }),
    );

    const data = page.map((a) => {
      const src = a.candidateId ? sources.get(a.candidateId) : undefined;
      const view = src ? toEmployerView({ ...src, photoUrl: photoUrls.get(src.id) ?? null }) : undefined;
      return toApplicantCard(a, view);
    });

    return { data, meta: pageMeta(pageNum, pageSize, total), counts: this.foldCounts(grouped) };
  }

  // ── Admin: GET /admin/applications ──────────────────────────────────────────

  /** Offset table (admin context: fuller card w/ candidate name + ids; no doc keys). */
  async listAdminApplications(opts: {
    page?: number;
    pageSize?: number;
    status?: ApplicationStatus;
    jobId?: string;
    search?: string;
  }): Promise<{ data: AdminApplicationCardDto[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, opts.pageSize ?? 20);

    let searchIds: string[] | undefined;
    if (opts.search) {
      searchIds = await this.candidateRead.searchCandidateIdsByName(opts.search);
    }

    const where: Prisma.ApplicationWhereInput = {
      ...(opts.status && { status: opts.status }),
      ...(opts.jobId && { jobId: opts.jobId }),
      ...(opts.search && {
        OR: [
          { humanId: { contains: opts.search, mode: 'insensitive' } },
          ...(searchIds && searchIds.length > 0 ? [{ candidateId: { in: searchIds } }] : []),
        ],
      }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.application.count({ where }),
    ]);

    const [names, jobs, overrideReasons] = await Promise.all([
      this.candidateRead.getNamesByIds(
        [...new Set(rows.map((a) => a.candidateId).filter((x): x is string => !!x))],
      ),
      this.jobsService.getJobSubsets([...new Set(rows.map((a) => a.jobId))]),
      this.latestOverrideReasons(rows.map((a) => a.id)),
    ]);

    const data = rows.map((a) => ({
      ...toApplicationResponse(a),
      candidateName: a.candidateId ? names.get(a.candidateId) ?? null : null,
      jobTitle: jobs.get(a.jobId)?.title ?? null,
      overrideReason: overrideReasons.get(a.id) ?? null,
    }));

    return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  // ── Admin: GET /admin/applications/{id} (0.8.1) ─────────────────────────────

  /**
   * The Screen 26 detail: the admin row + the FULL timeline, each entry with
   * its `overrideReason`. This is the record's only surface — the candidate's
   * shaped timeline deliberately excludes the reason and the employer never
   * sees a timeline at all.
   */
  async getAdminApplicationDetail(applicationId: string): Promise<AdminApplicationDetailDto> {
    const app = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!app) throw new NotFoundException({ code: 'APPLICATION_NOT_FOUND' });

    const [timeline, names, jobs] = await Promise.all([
      this.prisma.applicationTimelineEntry.findMany({
        where: { applicationId },
        orderBy: { createdAt: 'asc' },
      }),
      app.candidateId
        ? this.candidateRead.getNamesByIds([app.candidateId])
        : Promise.resolve(new Map<string, string>()),
      this.jobsService.getJobSubsets([app.jobId]),
    ]);

    // The row-level reason is DERIVED — the most recent override entry. The
    // applications table stores no reason column; the timeline is the record.
    const lastOverride = [...timeline].reverse().find((t) => t.isAdminOverride);

    return {
      ...toApplicationResponse(app),
      candidateName: app.candidateId ? names.get(app.candidateId) ?? null : null,
      jobTitle: jobs.get(app.jobId)?.title ?? null,
      overrideReason: lastOverride?.overrideReason ?? null,
      timeline: timeline.map((t) => ({
        fromStatus: t.fromStatus ?? null,
        toStatus: t.toStatus,
        actorRole: t.actorRole ?? null,
        isAdminOverride: t.isAdminOverride,
        overrideReason: t.overrideReason ?? null,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  }

  /** Batched most-recent override reason per application (one query per page). */
  private async latestOverrideReasons(applicationIds: string[]): Promise<Map<string, string | null>> {
    if (applicationIds.length === 0) return new Map();
    const entries = await this.prisma.applicationTimelineEntry.findMany({
      where: { applicationId: { in: applicationIds }, isAdminOverride: true },
      orderBy: { createdAt: 'desc' },
      select: { applicationId: true, overrideReason: true },
    });
    const map = new Map<string, string | null>();
    for (const e of entries) {
      if (!map.has(e.applicationId)) map.set(e.applicationId, e.overrideReason ?? null);
    }
    return map;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private foldCounts(
    grouped: { status: ApplicationStatus; _count: { _all: number } }[],
  ): ApplicantCounts {
    const counts: ApplicantCounts = { pending: 0, shortlisted: 0, selected: 0, rejected: 0 };
    for (const g of grouped) {
      if (g.status === ApplicationStatus.PENDING) counts.pending = g._count._all;
      else if (g.status === ApplicationStatus.SHORTLISTED) counts.shortlisted = g._count._all;
      else if (g.status === ApplicationStatus.SELECTED) counts.selected = g._count._all;
      else if (g.status === ApplicationStatus.REJECTED) counts.rejected = g._count._all;
    }
    return counts;
  }
}
