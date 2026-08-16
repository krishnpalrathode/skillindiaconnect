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

  // ── Admin analytics reads (Screen 22) ───────────────────────────────────────
  //
  // The dashboard needs history, and this platform keeps no snapshot table. It
  // does not need one: `createdAt` on applications and on the timeline rows IS
  // the history, so every series below is derived from rows that already exist.
  // That is why these are date-bucketed GROUP BYs rather than a nightly job.

  /** Applications per day by status — feeds the growth + stacked status charts. */
  async dailyStatusSeries(from: Date, to: Date): Promise<DailyStatusRow[]> {
    return this.prisma.$queryRaw<DailyStatusRow[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
             COUNT(*)::int                                              AS total,
             COUNT(*) FILTER (WHERE status = 'PENDING')::int            AS pending,
             COUNT(*) FILTER (WHERE status = 'SHORTLISTED')::int        AS shortlisted,
             COUNT(*) FILTER (WHERE status = 'SELECTED')::int           AS selected,
             COUNT(*) FILTER (WHERE status = 'REJECTED')::int           AS rejected
      FROM applications
      WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY 1 ORDER BY 1`;
  }

  /** Total applications and hires in a window — the KPI deltas. */
  async windowTotals(from: Date, to: Date): Promise<{ applications: number; hires: number }> {
    const rows = await this.prisma.$queryRaw<Array<{ applications: number; hires: number }>>`
      SELECT COUNT(*)::int AS applications,
             COUNT(*) FILTER (WHERE status = 'SELECTED')::int AS hires
      FROM applications
      WHERE "createdAt" >= ${from} AND "createdAt" < ${to}`;
    return rows[0] ?? { applications: 0, hires: 0 };
  }

  /**
   * The funnel cohort: of the applications CREATED in this window, how many ever
   * reached each stage.
   *
   * "EVER REACHED", not "is currently in". Counting current status makes the
   * funnel non-monotonic — an application that went PENDING→SHORTLISTED→SELECTED
   * stops being counted as shortlisted, so `selected` can exceed `shortlisted`
   * and the conversion rate reads above 100%. That is exactly what the first
   * version of this dashboard showed (109.4%). A funnel stage is a milestone the
   * application passed through, so it is read from `application_timeline`, which
   * is the only record of what an application HAS BEEN.
   *
   * The current status still counts as reached: an application sitting in
   * SHORTLISTED right now reached SHORTLISTED even if its timeline row predates
   * the window.
   */
  async funnelCohort(from: Date, to: Date): Promise<FunnelCohort> {
    const rows = await this.prisma.$queryRaw<Array<FunnelCohort>>`
      SELECT COUNT(*)::int AS applied,
             COUNT(*) FILTER (
               WHERE a.status IN ('SHORTLISTED', 'SELECTED')
                  OR EXISTS (SELECT 1 FROM application_timeline t
                             WHERE t."applicationId" = a.id AND t."toStatus" = 'SHORTLISTED')
             )::int AS shortlisted,
             COUNT(*) FILTER (
               WHERE a.status = 'SELECTED'
                  OR EXISTS (SELECT 1 FROM application_timeline t
                             WHERE t."applicationId" = a.id AND t."toStatus" = 'SELECTED')
             )::int AS selected
      FROM applications a
      WHERE a."createdAt" >= ${from} AND a."createdAt" < ${to}`;
    return rows[0] ?? { applied: 0, shortlisted: 0, selected: 0 };
  }

  /**
   * Median days between status transitions, from the timeline rows.
   *
   * MEDIAN, not mean: a single application left open for months drags an average
   * far away from what a typical candidate experiences, and "average time to
   * hire" is read as a typical case.
   *
   * NOTE the stages are PENDING→SHORTLISTED→SELECTED. There is no Interview step
   * because ApplicationStatus has no such value — the funnel cannot invent one.
   */
  async stageDurations(from: Date, to: Date): Promise<StageDurationRow[]> {
    return this.prisma.$queryRaw<StageDurationRow[]>`
      SELECT t."fromStatus"::text AS "fromStatus",
             t."toStatus"::text   AS "toStatus",
             COUNT(*)::int        AS transitions,
             ROUND(
               (percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM (t."createdAt" - a."createdAt")) / 86400.0
               ))::numeric, 1
             )::float8 AS "medianDays"
      FROM application_timeline t
      JOIN applications a ON a.id = t."applicationId"
      WHERE t."fromStatus" IS NOT NULL
        AND t."createdAt" >= ${from} AND t."createdAt" < ${to}
      GROUP BY 1, 2`;
  }
}

export interface DailyStatusRow {
  date: string;
  total: number;
  pending: number;
  shortlisted: number;
  selected: number;
  rejected: number;
}

export interface FunnelCohort {
  applied: number;
  shortlisted: number;
  selected: number;
}

export interface StageDurationRow {
  fromStatus: string;
  toStatus: string;
  transitions: number;
  medianDays: number;
}
