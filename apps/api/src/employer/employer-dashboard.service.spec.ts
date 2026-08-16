/**
 * Unit tests for EmployerDashboardService.
 *
 * Verifies that:
 * - activeJobs and totalJobViews come from JobsService (not direct DB query)
 * - Application KPIs (totalApplications, shortlisted, hiredThisMonth) are exactly 0
 * - recentApplicants is always []
 * - profileChecklist is computed from current company state
 * - Jobs data flows through getCompanyJobStats seam (module boundary held)
 */
import { CompanyStatus, CompanyType } from '@prisma/client';
import { EmployerDashboardService } from './employer-dashboard.service';
import { EmployerService } from './employer.service';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { ApplicationsAggregateService } from '../applications/applications-aggregate.service';

describe('EmployerDashboardService', () => {
  let service: EmployerDashboardService;
  let mockEmployerService: jest.Mocked<Pick<EmployerService, 'getCompanyForEmployerUser'>>;
  let mockJobsService: jest.Mocked<Pick<JobsService, 'getCompanyJobStats'>>;
  let mockPrisma: jest.Mocked<any>;

  const fakeCompany = {
    id: 'company-uuid',
    name: 'Gulf Builders Arabia',
    type: CompanyType.FOREIGN,
    status: CompanyStatus.APPROVED,
    registrationNumber: 'GB001',
    industryType: 'Construction',
    phoneCode: '+91',
    country: 'India',
    phone: '+966500000000',
    location: 'Riyadh',
    employeeRange: '201-500',
    languagePref: ['en', 'ar'],
    logoKey: 'companies/company-uuid/logo/x.jpg',
    description: 'Gulf construction firm.',
    website: null,
    rejectionReason: null,
    registrationCertKey: null,
    approvedAt: new Date(),
    reviewedById: null,
    suspendedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const fakeJobStats = {
    activeJobs: 3,
    totalJobViews: 87,
    recentJobs: [
      {
        id: 'j1',
        title: 'Electrician',
        market: 'GULF',
        location: 'Riyadh',
        salaryCurrency: 'SAR',
        salaryMin: 1500,
        salaryMax: 2500,
        accommodation: true,
        healthInsurance: true,
        transportation: true,
        companyName: 'Gulf Builders Arabia',
        createdAt: new Date().toISOString(),
        publishedAt: new Date().toISOString(),
        isSaved: null,
      },
    ],
  };

  const fakePrefs = {
    id: 'hp1',
    companyId: 'company-uuid',
    categories: [],
    preferredExp: null,
    jobMarketsPosted: [],
    countriesHiredFrom: [],
    languagesRequired: [],
    updatedAt: new Date(),
  };

  const fakeContacts = [
    {
      id: 'ct1',
      companyId: 'company-uuid',
      name: 'Ahmed',
      designation: 'HR',
      phone: null,
      email: null,
      hasWhatsapp: false,
      isPrimary: true,
      createdAt: new Date(),
    },
    {
      id: 'ct2',
      companyId: 'company-uuid',
      name: 'Fatima',
      designation: 'Admin',
      phone: null,
      email: null,
      hasWhatsapp: false,
      isPrimary: false,
      createdAt: new Date(),
    },
  ];

  beforeEach(() => {
    mockEmployerService = {
      getCompanyForEmployerUser: jest.fn().mockResolvedValue(fakeCompany),
    };

    mockJobsService = {
      getCompanyJobStats: jest.fn().mockResolvedValue(fakeJobStats),
    };

    mockPrisma = {
      hiringPreference: { findUnique: jest.fn().mockResolvedValue(fakePrefs) },
      contactPerson: { findMany: jest.fn().mockResolvedValue(fakeContacts) },
    };

    const mockAggregate = {
      countsForCompany: jest
        .fn()
        .mockResolvedValue({ total: 0, shortlisted: 0, hiredThisMonth: 0 }),
      recentApplicantsForCompany: jest.fn().mockResolvedValue([]),
    };

    service = new EmployerDashboardService(
      mockPrisma as unknown as PrismaService,
      mockEmployerService as unknown as EmployerService,
      mockJobsService as unknown as JobsService,
      mockAggregate as unknown as ApplicationsAggregateService,
    );
  });

  it('returns real activeJobs and totalJobViews from JobsService', async () => {
    const result = await service.getDashboard('user-1');
    expect(result.kpis.activeJobs).toBe(3);
    expect(result.kpis.totalJobViews).toBe(87);
  });

  it('application KPIs are exactly 0 (honest zeros until S4)', async () => {
    const result = await service.getDashboard('user-1');
    expect(result.kpis.totalApplications).toBe(0);
    expect(result.kpis.shortlisted).toBe(0);
    expect(result.kpis.hiredThisMonth).toBe(0);
  });

  it('recentApplicants is always [] (S4 fills this)', async () => {
    const result = await service.getDashboard('user-1');
    expect(result.recentApplicants).toEqual([]);
  });

  it('recentJobs is populated from JobsService stats', async () => {
    const result = await service.getDashboard('user-1');
    expect(result.recentJobs).toHaveLength(1);
    expect((result.recentJobs[0] as any).title).toBe('Electrician');
  });

  it('profileChecklist reflects current company state (hasLogo, hasDescription, hasSecondContact)', async () => {
    const result = await service.getDashboard('user-1');
    expect(result.profileChecklist.hasLogo).toBe(true); // logoKey is set
    expect(result.profileChecklist.hasDescription).toBe(true); // description is set
    expect(result.profileChecklist.hasHiringPreferences).toBe(true); // prefs row exists
    expect(result.profileChecklist.hasSecondContact).toBe(true); // 2 contacts
    expect(result.profileChecklist.hint).toBeNull(); // all checks pass
  });

  it('profileChecklist.hint fires when logo is missing', async () => {
    mockEmployerService.getCompanyForEmployerUser.mockResolvedValue({
      ...fakeCompany,
      logoKey: null,
    });
    const result = await service.getDashboard('user-1');
    expect(result.profileChecklist.hasLogo).toBe(false);
    expect(result.profileChecklist.hint).toMatch(/logo/i);
  });

  it('jobs data flows through getCompanyJobStats — not direct job table query (boundary check)', async () => {
    await service.getDashboard('user-1');
    // JobsService.getCompanyJobStats was called — that is the boundary seam
    expect(mockJobsService.getCompanyJobStats).toHaveBeenCalledWith('company-uuid');
    // Employer module's Prisma mock has no job model — it never touches the jobs table
    expect(mockPrisma.job).toBeUndefined();
  });
});
