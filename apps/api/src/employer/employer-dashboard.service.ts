import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { EmployerService } from './employer.service';
import { computeChecklist, ProfileChecklist } from './employer-profile.service';

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
  recentApplicants: never[];
  profileChecklist: ProfileChecklist;
}

/**
 * Assembles the real S3 employer dashboard.
 *
 * Job aggregates come through JobsService — the Employer module never queries
 * the jobs table directly (module-boundaries.md Rule 4).
 *
 * Application KPIs (totalApplications, shortlisted, hiredThisMonth) are honest
 * zeros until Sprint 4 (applications module). recentApplicants is always [].
 */
@Injectable()
export class EmployerDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employerService: EmployerService,
    @Inject(forwardRef(() => JobsService))
    private readonly jobsService: JobsService,
  ) {}

  async getDashboard(userId: string): Promise<EmployerDashboard> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);

    const [jobStats, prefs, contacts] = await Promise.all([
      this.jobsService.getCompanyJobStats(company.id),
      this.prisma.hiringPreference.findUnique({ where: { companyId: company.id } }),
      this.prisma.contactPerson.findMany({ where: { companyId: company.id } }),
    ]);

    return {
      kpis: {
        activeJobs: jobStats.activeJobs,
        totalApplications: 0, // S4 fills this (applications module)
        shortlisted: 0,       // S4 fills this
        totalJobViews: jobStats.totalJobViews,
        hiredThisMonth: 0,    // S4 fills this (SELECTED status in current calendar month)
      },
      recentJobs: jobStats.recentJobs,
      recentApplicants: [], // S4 fills this — typed CandidateEmployerView[] once live
      profileChecklist: computeChecklist(company, prefs, contacts),
    };
  }
}
