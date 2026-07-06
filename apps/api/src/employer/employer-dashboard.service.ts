import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { EmployerService } from './employer.service';
import { computeChecklist, ProfileChecklist } from './employer-profile.service';
import {
  ApplicantSummaryDto,
  ApplicationsAggregateService,
} from '../applications/applications-aggregate.service';

const RECENT_APPLICANTS_LIMIT = 5;

export interface EmployerDashboardKpi {
  activeJobs: number;
  totalApplications: number;
  shortlisted: number;
  totalJobViews: number;
  hiredThisMonth: number;
}

export interface EmployerDashboard {
  kpis: EmployerDashboardKpi;
  recentJobs: unknown[];
  recentApplicants: ApplicantSummaryDto[];
  profileChecklist: ProfileChecklist;
}

/**
 * Assembles the employer dashboard.
 *
 * Job aggregates come through JobsService; application aggregates through the
 * exported ApplicationsAggregateService — the Employer module never queries the
 * jobs OR applications tables directly (module-boundaries.md Rule 4).
 *
 * As of S4-B3 the application KPIs (totalApplications, shortlisted, hiredThisMonth)
 * and recentApplicants are LIVE.
 */
@Injectable()
export class EmployerDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employerService: EmployerService,
    @Inject(forwardRef(() => JobsService))
    private readonly jobsService: JobsService,
    @Inject(forwardRef(() => ApplicationsAggregateService))
    private readonly applicationsAggregate: ApplicationsAggregateService,
  ) {}

  async getDashboard(userId: string): Promise<EmployerDashboard> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);

    const [jobStats, prefs, contacts, appCounts, recentApplicants] = await Promise.all([
      this.jobsService.getCompanyJobStats(company.id),
      this.prisma.hiringPreference.findUnique({ where: { companyId: company.id } }),
      this.prisma.contactPerson.findMany({ where: { companyId: company.id } }),
      this.applicationsAggregate.countsForCompany(company.id),
      this.applicationsAggregate.recentApplicantsForCompany(company.id, RECENT_APPLICANTS_LIMIT),
    ]);

    return {
      kpis: {
        activeJobs: jobStats.activeJobs,
        totalApplications: appCounts.total,
        shortlisted: appCounts.shortlisted,
        totalJobViews: jobStats.totalJobViews,
        hiredThisMonth: appCounts.hiredThisMonth,
      },
      recentJobs: jobStats.recentJobs,
      recentApplicants,
      profileChecklist: computeChecklist(company, prefs, contacts),
    };
  }
}
