import { Injectable } from '@nestjs/common';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { EmployerService } from '../employer/employer.service';
import { JobsService } from '../jobs/jobs.service';
import { ApplicationsAggregateService } from '../applications/applications-aggregate.service';
import { SubscriptionReadService } from '../payments/subscription-read.service';

export interface AdminDashboardDto {
  counts: {
    candidates: { total: number; active: number };
    employers: Record<string, number>;
    jobs: Record<string, number>;
    applications: Record<string, number>;
  };
  revenueThisMonthSubunits: number;
  currency: string;
  pendingEmployerReviews: number;
  pendingJobReviews: number;
}

// The platform is INR-denominated (S5: money is integer subunits + a currency).
const PLATFORM_CURRENCY = 'INR';

/**
 * Admin dashboard KPIs.
 *
 * THIS SERVICE OWNS NO TABLES and issues NO Prisma queries. Every figure comes
 * from the owning module's public service export (module-boundaries Rule 4) —
 * candidates from CandidateReadService, companies from EmployerService, jobs
 * from JobsService, applications from ApplicationsAggregateService, revenue from
 * SubscriptionReadService. If a count is missing, the fix is a narrow read on the
 * OWNING module, never a query here.
 *
 * Cost: FIVE queries total, all grouped/aggregate, all issued in parallel. No
 * N+1 is possible because no count is computed per-row — each is a single
 * `GROUP BY status` or `SUM(...)` executed in Postgres.
 *
 * Not cached. Five grouped counts is not a heavy page, and a stale approval-queue
 * depth is worse than a fast one — an admin acting on `pendingEmployerReviews: 0`
 * that is actually 3 has been actively misled. If this ever gets heavy, cache it
 * in Redis for 30–60s and accept that staleness EXPLICITLY.
 */
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly candidateRead: CandidateReadService,
    private readonly employerService: EmployerService,
    private readonly jobsService: JobsService,
    private readonly applicationsAggregate: ApplicationsAggregateService,
    private readonly subscriptionRead: SubscriptionReadService,
  ) {}

  async getDashboard(): Promise<AdminDashboardDto> {
    const [candidates, employers, jobs, applications, revenueThisMonthSubunits] =
      await Promise.all([
        this.candidateRead.countCandidates(),
        this.employerService.countByStatus(),
        this.jobsService.countByStatus(),
        this.applicationsAggregate.countsPlatformWide(),
        this.subscriptionRead.revenueThisMonthSubunits(),
      ]);

    return {
      counts: { candidates, employers, jobs, applications },
      revenueThisMonthSubunits,
      currency: PLATFORM_CURRENCY,
      // The two work-queue depths are DERIVED from the maps above — issuing
      // separate COUNT queries for them would be two more round-trips for
      // numbers we already have.
      pendingEmployerReviews: employers['PENDING'] ?? 0,
      pendingJobReviews: jobs['PENDING_REVIEW'] ?? 0,
    };
  }
}
