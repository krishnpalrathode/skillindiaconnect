import { Injectable, NotFoundException } from '@nestjs/common';
import { Application, ApplicationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
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
}

export interface ApplicantCounts {
  pending: number;
  shortlisted: number;
  selected: number;
  rejected: number;
}

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

function encodeCursor(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function decodeCursor<T>(cursor: string | undefined): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
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

  /** Cursor feed, newest first (createdAt DESC, id DESC — stable keyset). */
  async listCandidateApplications(
    candidateId: string,
    opts: { cursor?: string; limit?: number; status?: ApplicationStatus },
  ): Promise<CursorPage<ApplicationCardDto>> {
    const limit = Math.min(opts.limit ?? 20, 100);
    const cur = decodeCursor<{ createdAt: string; id: string }>(opts.cursor);

    const rows = await this.prisma.application.findMany({
      where: {
        candidateId,
        ...(opts.status && { status: opts.status }),
        ...(cur && {
          OR: [
            { createdAt: { lt: new Date(cur.createdAt) } },
            { createdAt: new Date(cur.createdAt), id: { lt: cur.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const { page, nextCursor } = this.paginate(rows, limit, (a) => ({
      createdAt: a.createdAt.toISOString(),
      id: a.id,
    }));

    const jobs = await this.jobsService.getJobSubsets([...new Set(page.map((a) => a.jobId))]);
    return { data: page.map((a) => toApplicationCard(a, jobs.get(a.jobId))), nextCursor };
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
   * caller with the resolved companyId). Cursor + match|recent sort + per-status
   * counts. Each card COMPOSES the S3 employer-context subset (privacy inherited).
   */
  async listJobApplicants(
    jobId: string,
    callerCompanyId: string,
    opts: { cursor?: string; limit?: number; status?: ApplicationStatus; sort?: ApplicantSort },
  ): Promise<CursorPage<ApplicantCardDto> & { counts: ApplicantCounts }> {
    // Ownership: the job must belong to the caller's company → else 404.
    const job = await this.jobsService.getJobForApplication(jobId);
    if (job.companyId !== callerCompanyId) {
      throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
    }

    const limit = Math.min(opts.limit ?? 20, 100);
    const sort: ApplicantSort = opts.sort === 'recent' ? 'recent' : 'match';

    const where: Prisma.ApplicationWhereInput = {
      jobId,
      ...(opts.status && { status: opts.status }),
      ...this.applicantCursorWhere(sort, opts.cursor),
    };
    const orderBy: Prisma.ApplicationOrderByWithRelationInput[] =
      sort === 'recent'
        ? [{ createdAt: 'desc' }, { id: 'desc' }]
        : [{ matchScore: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }];

    const [rows, grouped] = await Promise.all([
      this.prisma.application.findMany({ where, orderBy, take: limit + 1 }),
      this.prisma.application.groupBy({ by: ['status'], where: { jobId }, _count: { _all: true } }),
    ]);

    const { page, nextCursor } = this.paginate(rows, limit, (a) =>
      sort === 'recent'
        ? { createdAt: a.createdAt.toISOString(), id: a.id }
        : { matchScore: a.matchScore, createdAt: a.createdAt.toISOString(), id: a.id },
    );

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

    return { data, nextCursor, counts: this.foldCounts(grouped) };
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

    const [names, jobs] = await Promise.all([
      this.candidateRead.getNamesByIds(
        [...new Set(rows.map((a) => a.candidateId).filter((x): x is string => !!x))],
      ),
      this.jobsService.getJobSubsets([...new Set(rows.map((a) => a.jobId))]),
    ]);

    const data = rows.map((a) => ({
      ...toApplicationResponse(a),
      candidateName: a.candidateId ? names.get(a.candidateId) ?? null : null,
      jobTitle: jobs.get(a.jobId)?.title ?? null,
    }));

    return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private paginate<T extends Application>(
    rows: T[],
    limit: number,
    keyOf: (a: T) => Record<string, unknown>,
  ): { page: T[]; nextCursor: string | null } {
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && pageRows.length > 0 ? encodeCursor(keyOf(pageRows[pageRows.length - 1]!)) : null;
    return { page: pageRows, nextCursor };
  }

  private applicantCursorWhere(sort: ApplicantSort, cursor: string | undefined): Prisma.ApplicationWhereInput {
    if (sort === 'recent') {
      const c = decodeCursor<{ createdAt: string; id: string }>(cursor);
      if (!c) return {};
      return {
        OR: [
          { createdAt: { lt: new Date(c.createdAt) } },
          { createdAt: new Date(c.createdAt), id: { lt: c.id } },
        ],
      };
    }
    const c = decodeCursor<{ matchScore: number; createdAt: string; id: string }>(cursor);
    if (!c) return {};
    return {
      OR: [
        { matchScore: { lt: c.matchScore } },
        { matchScore: c.matchScore, createdAt: { lt: new Date(c.createdAt) } },
        { matchScore: c.matchScore, createdAt: new Date(c.createdAt), id: { lt: c.id } },
      ],
    };
  }

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
