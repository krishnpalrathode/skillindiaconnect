import { Injectable } from '@nestjs/common';
import { ApplicationStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { CandidateReadService } from '../candidate/candidate-read.service';

export interface CompanyApplicationCounts {
  total: number;
  shortlisted: number;
  hiredThisMonth: number;
}

export interface CandidateApplicationCounts {
  applied: number;
  shortlisted: number;
}

export interface PerJobCounts {
  applications: number;
  shortlisted: number;
}

/** Frozen S4-0 ApplicantSummary — employer-context (name only, no phone/religion/dob). */
export interface ApplicantSummaryDto {
  applicationId: string;
  candidateId: string | null;
  candidateName: string | null;
  jobId: string;
  jobTitle: string | null;
  status: ApplicationStatus;
  matchScore: number;
  appliedAt: string;
}

/**
 * The ONLY place other modules read application aggregates from (exported). The
 * dashboards (employer + candidate) and My-Jobs counts call these narrow, batched
 * methods — no module queries the applications table itself (Rule 4 + zone lint).
 *
 * `hiredThisMonth` DEFINITION: applications on the company's jobs that are CURRENTLY
 * SELECTED and whose transition INTO SELECTED occurred within the current calendar
 * month (UTC month boundary) — i.e. "became a hire this month". A later admin
 * correction away from SELECTED drops it from the count.
 */
@Injectable()
export class ApplicationsAggregateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobsService: JobsService,
    private readonly candidateRead: CandidateReadService,
  ) {}

  async countsForCompany(companyId: string): Promise<CompanyApplicationCounts> {
    const jobIds = await this.jobsService.getJobIdsForCompany(companyId);
    if (jobIds.length === 0) return { total: 0, shortlisted: 0, hiredThisMonth: 0 };

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [grouped, hiredThisMonth] = await Promise.all([
      this.prisma.application.groupBy({
        by: ['status'],
        where: { jobId: { in: jobIds } },
        _count: { _all: true },
      }),
      this.prisma.application.count({
        where: {
          jobId: { in: jobIds },
          status: ApplicationStatus.SELECTED,
          timeline: {
            some: { toStatus: ApplicationStatus.SELECTED, createdAt: { gte: monthStart } },
          },
        },
      }),
    ]);

    const total = grouped.reduce((sum, g) => sum + g._count._all, 0);
    const shortlisted =
      grouped.find((g) => g.status === ApplicationStatus.SHORTLISTED)?._count._all ?? 0;

    return { total, shortlisted, hiredThisMonth };
  }

  async recentApplicantsForCompany(companyId: string, n: number): Promise<ApplicantSummaryDto[]> {
    const jobIds = await this.jobsService.getJobIdsForCompany(companyId);
    if (jobIds.length === 0) return [];

    const rows = await this.prisma.application.findMany({
      where: { jobId: { in: jobIds } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: n,
    });

    const [names, jobs] = await Promise.all([
      this.candidateRead.getNamesByIds([
        ...new Set(rows.map((a) => a.candidateId).filter((x): x is string => !!x)),
      ]),
      this.jobsService.getJobSubsets([...new Set(rows.map((a) => a.jobId))]),
    ]);

    return rows.map((a) => ({
      applicationId: a.id,
      candidateId: a.candidateId,
      candidateName: a.candidateId ? (names.get(a.candidateId) ?? null) : null,
      jobId: a.jobId,
      jobTitle: jobs.get(a.jobId)?.title ?? null,
      status: a.status,
      matchScore: a.matchScore,
      appliedAt: a.createdAt.toISOString(),
    }));
  }

  async countsForCandidate(candidateId: string): Promise<CandidateApplicationCounts> {
    const grouped = await this.prisma.application.groupBy({
      by: ['status'],
      where: { candidateId },
      _count: { _all: true },
    });
    const applied = grouped.reduce((sum, g) => sum + g._count._all, 0);
    const shortlisted =
      grouped.find((g) => g.status === ApplicationStatus.SHORTLISTED)?._count._all ?? 0;
    return { applied, shortlisted };
  }

  /**
   * S6a-B1 (admin dashboard): platform-wide application counts keyed by
   * ApplicationStatus. ONE grouped query.
   */
  async countsPlatformWide(): Promise<Record<string, number>> {
    const grouped = await this.prisma.application.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    // Zero-filled so the dashboard's fixed tile set never loses a column.
    const counts: Record<string, number> = {
      PENDING: 0,
      SHORTLISTED: 0,
      SELECTED: 0,
      REJECTED: 0,
    };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
    }
    return counts;
  }

  /**
   * Batched per-job counts for the My Jobs table — ONE grouped query for the whole
   * page (never N queries for N rows). Jobs absent from the result have zero counts.
   */
  async countsPerJob(jobIds: string[]): Promise<Map<string, PerJobCounts>> {
    const result = new Map<string, PerJobCounts>(
      jobIds.map((id) => [id, { applications: 0, shortlisted: 0 }]),
    );
    if (jobIds.length === 0) return result;

    const grouped = await this.prisma.application.groupBy({
      by: ['jobId', 'status'],
      where: { jobId: { in: jobIds } },
      _count: { _all: true },
    });

    for (const g of grouped) {
      const entry = result.get(g.jobId) ?? { applications: 0, shortlisted: 0 };
      entry.applications += g._count._all;
      if (g.status === ApplicationStatus.SHORTLISTED) entry.shortlisted += g._count._all;
      result.set(g.jobId, entry);
    }
    return result;
  }
}
