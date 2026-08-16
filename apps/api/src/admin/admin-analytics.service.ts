import { Injectable } from '@nestjs/common';
import { CandidateReadService, BucketRow } from '../candidate/candidate-read.service';
import { EmployerService } from '../employer/employer.service';
import { JobsService } from '../jobs/jobs.service';
import { ApplicationsAggregateService } from '../applications/applications-aggregate.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../settings/settings.keys';
import { SubscriptionReadService } from '../payments/subscription-read.service';

/** A KPI tile: the current window's value, its delta vs the previous window, and its sparkline. */
export interface KpiDto {
  value: number;
  previous: number;
  /** Percent change vs the previous window. `null` when the previous window was zero. */
  deltaPct: number | null;
  /** One point per day of the current window — the sparkline behind the number. */
  spark: number[];
}

export interface SeriesPoint {
  date: string;
  [series: string]: string | number;
}

export interface FunnelStageDto {
  stage: string;
  count: number;
  /** Share of the widest stage (applications). Always ≤ 100. */
  pctOfTop: number;
  /** Share retained from the PREVIOUS stage — `null` for the first stage. */
  conversionFromPrev: number | null;
}

export interface AdminAnalyticsDto {
  range: { from: string; to: string; days: number };
  kpis: {
    candidates: KpiDto;
    employers: KpiDto;
    jobs: KpiDto;
    applications: KpiDto;
    hires: KpiDto;
  };
  /**
   * Revenue invoiced in the window, INTEGER SUBUNITS — never a float, never
   * formatted here. The server owns every amount (money.ts); the client formats.
   */
  revenue: KpiDto;
  currency: string;
  candidateGrowth: SeriesPoint[];
  employerGrowth: SeriesPoint[];
  jobActivity: SeriesPoint[];
  applicationTrend: SeriesPoint[];
  funnel: FunnelStageDto[];
  applicationStatus: Array<{ status: string; count: number }>;
  topJobs: Array<{
    title: string;
    employerName: string;
    status: string;
    applications: number;
    shortlisted: number;
    hires: number;
  }>;
  topEmployers: Array<{
    name: string;
    activeJobs: number;
    applications: number;
    hires: number;
    successRate: number;
  }>;
  topSkills: Array<{ name: string; count: number }>;
  demographics: { experience: BucketRow[]; age: BucketRow[] };
  employerStatus: Array<{ status: string; count: number }>;
  jobStatus: Array<{ status: string; count: number }>;
  efficiency: {
    /** Median days from apply → shortlist, and shortlist → selected. `null` when no transitions. */
    daysToShortlist: number | null;
    daysToHire: number | null;
    /** Hires ÷ applications over the window, as a percentage. */
    hireRate: number;
    /** Applications ÷ jobs created in the window. */
    applicationsPerJob: number;
  };
  needsAttention: {
    pendingEmployerReviews: number;
    pendingJobReviews: number;
    pendingApplications: number;
    incompleteProfiles: number;
    completionThreshold: number;
  };
}

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

// The platform is INR-denominated (S5: money is integer subunits + a currency).
const PLATFORM_CURRENCY = 'INR';

/**
 * The analytics behind the admin dashboard.
 *
 * Like AdminDashboardService, this OWNS NO TABLES and issues NO Prisma queries —
 * every figure comes from a narrow analytics read on the module that owns the
 * rows (module-boundaries Rule 4). What lives here is COMPOSITION: window maths,
 * previous-period deltas, zero-filling, and the derived ratios.
 *
 * There is no snapshot table and none is needed: `createdAt` on candidates,
 * companies, jobs and applications — plus the `application_timeline` rows — ARE
 * the history. Every series is a date-bucketed GROUP BY over rows that already
 * exist, so the dashboard is correct the moment it ships rather than after a
 * nightly job has run for a month.
 *
 * ZERO-FILLING is done here, not in SQL. A day with no registrations produces no
 * row, and a line chart that silently skips missing days draws a slope between
 * two non-adjacent dates — which reads as steady growth across a dead week. Every
 * series returned by this service has exactly one point per day in the range.
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(
    private readonly candidateRead: CandidateReadService,
    private readonly employerService: EmployerService,
    private readonly jobsService: JobsService,
    private readonly applicationsAggregate: ApplicationsAggregateService,
    private readonly settings: SettingsService,
    private readonly subscriptionRead: SubscriptionReadService,
  ) {}

  async getAnalytics(daysRaw?: number): Promise<AdminAnalyticsDto> {
    const days = clampDays(daysRaw);

    // UTC day boundaries. `to` is EXCLUSIVE and sits at the start of tomorrow, so
    // today's partial day is included — an admin looking at "last 7 days" at noon
    // expects to see this morning's signups.
    const now = new Date();
    const to = startOfUtcDay(now, 1);
    const from = startOfUtcDay(now, 1 - days);
    // The comparison window is the SAME LENGTH immediately before `from`, so a
    // 30-day delta compares 30 days to 30 days, never 30 to a partial stub.
    const prevFrom = startOfUtcDay(now, 1 - days * 2);

    const [
      candidateSeries,
      employerSeries,
      jobSeries,
      applicationSeries,
      current,
      previous,
      stageDurations,
      funnelCohort,
      statusCounts,
      employerStatus,
      jobStatus,
      topJobs,
      topEmployers,
      topSkills,
      demographics,
      completionThreshold,
      revenue,
      prevRevenue,
    ] = await Promise.all([
      this.candidateRead.dailyGrowthSeries(from, to),
      this.employerService.dailyEmployerSeries(from, to),
      this.jobsService.dailyJobSeries(from, to),
      this.applicationsAggregate.dailyStatusSeries(from, to),
      this.windowCounts(from, to),
      this.windowCounts(prevFrom, from),
      this.applicationsAggregate.stageDurations(from, to),
      this.applicationsAggregate.funnelCohort(from, to),
      this.applicationsAggregate.countsPlatformWide(),
      this.employerService.countByStatus(),
      this.jobsService.countByStatus(),
      this.jobsService.topPerformingJobs(5),
      this.employerService.leaderboard(5),
      this.candidateRead.topSkills(10),
      this.candidateRead.demographics(),
      this.settings.get(SETTING_KEYS.MIN_COMPLETION_PCT),
      this.subscriptionRead.revenueBetweenSubunits(from, to),
      this.subscriptionRead.revenueBetweenSubunits(prevFrom, from),
    ]);

    const threshold = Number(completionThreshold ?? 0);
    const incompleteProfiles = await this.candidateRead.countIncompleteProfiles(threshold);

    const dates = dateRange(from, days);
    const candidateGrowth = zeroFill(dates, candidateSeries, [
      'registrations',
      'verified',
      'active',
    ]);
    const employerGrowth = zeroFill(dates, employerSeries, ['registered', 'approved']);
    const jobActivity = zeroFill(dates, jobSeries, ['created', 'published', 'archived']);
    const applicationTrend = zeroFill(dates, applicationSeries, [
      'total',
      'pending',
      'shortlisted',
      'selected',
      'rejected',
    ]);

    const applications = current.applications;
    const selected = current.hires;

    return {
      range: { from: from.toISOString(), to: to.toISOString(), days },
      kpis: {
        candidates: kpi(current.candidates, previous.candidates, spark(candidateGrowth, 'registrations')),
        employers: kpi(current.employers, previous.employers, spark(employerGrowth, 'registered')),
        jobs: kpi(current.jobs, previous.jobs, spark(jobActivity, 'created')),
        applications: kpi(applications, previous.applications, spark(applicationTrend, 'total')),
        hires: kpi(selected, previous.hires, spark(applicationTrend, 'selected')),
      },
      // No sparkline: invoices are sparse and lumpy, and a 30-point line that is
      // flat-zero except for two spikes says less than the number itself does.
      revenue: kpi(revenue, prevRevenue, []),
      currency: PLATFORM_CURRENCY,
      candidateGrowth,
      employerGrowth,
      jobActivity,
      applicationTrend,
      // The funnel is APPLICATIONS → SHORTLISTED → SELECTED. There is no
      // "Interview" stage and no "Withdrawn" drop-off because ApplicationStatus
      // has no such values — a funnel that invents a stage is a lie about the
      // pipeline, and inventing one here would make every conversion below it wrong.
      funnel: buildFunnel([
        { stage: 'applied', count: funnelCohort.applied },
        { stage: 'shortlisted', count: funnelCohort.shortlisted },
        { stage: 'selected', count: funnelCohort.selected },
      ]),
      applicationStatus: Object.entries(statusCounts).map(([status, count]) => ({ status, count: Number(count) })),
      topJobs,
      topEmployers: topEmployers.map((e) => ({
        ...e,
        successRate: e.applications > 0 ? round1((e.hires / e.applications) * 100) : 0,
      })),
      topSkills,
      demographics,
      employerStatus: Object.entries(employerStatus).map(([status, count]) => ({ status, count: Number(count) })),
      jobStatus: Object.entries(jobStatus).map(([status, count]) => ({ status, count: Number(count) })),
      efficiency: {
        daysToShortlist: medianFor(stageDurations, 'PENDING', 'SHORTLISTED'),
        daysToHire: medianFor(stageDurations, 'SHORTLISTED', 'SELECTED'),
        hireRate: applications > 0 ? round1((selected / applications) * 100) : 0,
        applicationsPerJob: current.jobs > 0 ? round1(applications / current.jobs) : 0,
      },
      needsAttention: {
        pendingEmployerReviews: employerStatus['PENDING'] ?? 0,
        pendingJobReviews: jobStatus['PENDING_REVIEW'] ?? 0,
        pendingApplications: statusCounts['PENDING'] ?? 0,
        incompleteProfiles,
        completionThreshold: threshold,
      },
    };
  }

  /** The five window totals, in parallel — used for both the current and previous period. */
  private async windowCounts(from: Date, to: Date) {
    const [candidates, employers, jobs, apps] = await Promise.all([
      this.candidateRead.countCreatedBetween(from, to),
      this.employerService.countCreatedBetween(from, to),
      this.jobsService.countCreatedBetween(from, to),
      this.applicationsAggregate.windowTotals(from, to),
    ]);
    return { candidates, employers, jobs, applications: apps.applications, hires: apps.hires };
  }
}

// ── Pure helpers (exported for unit tests) ───────────────────────────────────

export function clampDays(raw?: number): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(1, Math.floor(raw)));
}

/** Start of the UTC day `offsetDays` from today (negative = past). */
function startOfUtcDay(now: Date, offsetDays: number): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays),
  );
}

/** Every `YYYY-MM-DD` in the window, in order — the x-axis every series is aligned to. */
export function dateRange(from: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(from.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Align a sparse SQL result to the full date axis.
 *
 * Days with no rows become explicit zeros rather than gaps — see the class note:
 * a line drawn straight over a missing week is a false claim about that week.
 */
export function zeroFill(
  dates: string[],
  rows: ReadonlyArray<{ date: string }>,
  fields: string[],
): SeriesPoint[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return dates.map((date) => {
    const row = byDate.get(date);
    const point: SeriesPoint = { date };
    const bag = row as Record<string, unknown> | undefined;
    for (const f of fields) point[f] = bag ? Number(bag[f] ?? 0) : 0;
    return point;
  });
}

function spark(points: SeriesPoint[], field: string): number[] {
  return points.map((p) => Number(p[field] ?? 0));
}

export function kpi(value: number, previous: number, sparkline: number[]): KpiDto {
  return {
    value,
    previous,
    // A jump from 0 is not "infinity percent" and not "100% growth" — it has no
    // meaningful rate, so the tile renders "new" instead of a fabricated number.
    deltaPct: previous > 0 ? round1(((value - previous) / previous) * 100) : null,
    spark: sparkline,
  };
}

export function buildFunnel(stages: Array<{ stage: string; count: number }>): FunnelStageDto[] {
  const top = stages[0]?.count ?? 0;
  return stages.map((s, i) => {
    const prev = i > 0 ? stages[i - 1]?.count ?? 0 : null;
    return {
      stage: s.stage,
      count: s.count,
      pctOfTop: top > 0 ? round1((s.count / top) * 100) : 0,
      conversionFromPrev: prev === null ? null : prev > 0 ? round1((s.count / prev) * 100) : 0,
    };
  });
}

function medianFor(
  rows: Array<{ fromStatus: string; toStatus: string; medianDays: number }>,
  from: string,
  to: string,
): number | null {
  const row = rows.find((r) => r.fromStatus === from && r.toStatus === to);
  return row ? row.medianDays : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
