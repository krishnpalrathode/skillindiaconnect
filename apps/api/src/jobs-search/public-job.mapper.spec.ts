/**
 * Unit tests for public-job.mapper — verifies the data-layer privacy boundary.
 *
 * JobCard and JobDetail must contain ONLY the public subset.
 * Internal fields (postedByAdminId, autoArchiveAt, pausedAt, archivedAt, searchVector,
 * createdAt, updatedAt, status, companyId raw, contact persons, employer PII) must
 * be ABSENT from the mapped output — enforced by asserting on raw object keys.
 */
import { CompanyStatus, Currency, EmploymentType, JobMarket } from '@prisma/client';
import {
  JobCard,
  JobCardData,
  JobDetail,
  JobDetailData,
  toJobCard,
  toJobDetail,
} from './public-job.mapper';

// ─────── Fixtures ─────────────────────────────────────────────────────────────

function makeCardData(overrides: Partial<JobCardData> = {}): JobCardData {
  return {
    id: 'job-1',
    humanId: 'JB-2026-1',
    title: 'Electrician',
    market: JobMarket.FOREIGN,
    location: 'Dubai',
    employmentType: EmploymentType.FULL_TIME,
    categoryId: 'cat-1',
    salaryMin: 80000,
    salaryMax: 120000,
    currency: Currency.AED,
    accommodation: true,
    healthInsurance: true,
    transportation: true,
    foodAllowance: false,
    airTicketArrival: true,
    airTicketDeparture: true,
    isFeatured: false,
    isUrgent: true,
    publishedAt: new Date('2026-01-15T10:00:00Z'),
    viewsCount: 42,
    companyId: 'co-1',
    category: { slug: 'electrical', nameEn: 'Electrical', nameHi: null, nameAr: 'كهربائي' },
    company: {
      id: 'co-1',
      name: 'Gulf Corp',
      status: CompanyStatus.APPROVED,
      industryType: 'Construction',
      location: 'Dubai',
    },
    ...overrides,
  } as unknown as JobCardData;
}

function makeDetailData(overrides: Partial<JobDetailData> = {}): JobDetailData {
  return {
    ...makeCardData(),
    description: '<p>Install electrical systems</p>',
    requirements: ['3 years experience', 'DEWA license'],
    experienceRequiredYears: 3,
    hoursPerDay: 8,
    daysPerWeek: 6,
    overtime: false,
    overtimeRateSubunits: null,
    contractPeriodMonths: 24,
    vacancies: 5,
    genderPreference: null,
    otherAllowance: 'Laundry allowance',
    company: {
      id: 'co-1',
      name: 'Gulf Corp',
      status: CompanyStatus.APPROVED,
      industryType: 'Construction',
      location: 'Dubai',
      description: 'Leading construction company',
      employeeRange: '501-1000',
    },
    ...overrides,
  } as unknown as JobDetailData;
}

// ─────── toJobCard ─────────────────────────────────────────────────────────────

describe('toJobCard', () => {
  let card: JobCard;

  beforeEach(() => {
    card = toJobCard(makeCardData());
  });

  it('maps all public card fields', () => {
    expect(card.id).toBe('job-1');
    expect(card.humanId).toBe('JB-2026-1');
    expect(card.title).toBe('Electrician');
    expect(card.market).toBe(JobMarket.FOREIGN);
    expect(card.location).toBe('Dubai');
    expect(card.employmentType).toBe(EmploymentType.FULL_TIME);
    expect(card.salaryMin).toBe(80000);
    expect(card.salaryMax).toBe(120000);
    expect(card.currency).toBe(Currency.AED);
    expect(card.isFeatured).toBe(false);
    expect(card.isUrgent).toBe(true);
    expect(card.viewsCount).toBe(42);
    expect(card.publishedAt).toEqual(new Date('2026-01-15T10:00:00Z'));
  });

  it('maps category subset (slug, nameEn, nameHi, nameAr)', () => {
    expect(card.category.slug).toBe('electrical');
    expect(card.category.nameEn).toBe('Electrical');
    expect(card.category.nameHi).toBeNull();
    expect(card.category.nameAr).toBe('كهربائي');
  });

  it('maps company with isVerified derived from status', () => {
    expect(card.company.id).toBe('co-1');
    expect(card.company.name).toBe('Gulf Corp');
    expect(card.company.isVerified).toBe(true); // APPROVED → true
    expect(card.company.industryType).toBe('Construction');
    expect(card.company.location).toBe('Dubai');
  });

  it('marks non-approved company as not verified', () => {
    const pendingCard = toJobCard(
      makeCardData({
        company: {
          id: 'co-2',
          name: 'New Corp',
          status: CompanyStatus.PENDING,
          industryType: 'IT',
          location: 'Mumbai',
        },
      } as Partial<JobCardData>),
    );
    expect(pendingCard.company.isVerified).toBe(false);
  });

  it('does NOT include internal fields (postedByAdminId, autoArchiveAt, pausedAt, archivedAt)', () => {
    const keys = Object.keys(card);
    expect(keys).not.toContain('postedByAdminId');
    expect(keys).not.toContain('autoArchiveAt');
    expect(keys).not.toContain('pausedAt');
    expect(keys).not.toContain('archivedAt');
    expect(keys).not.toContain('status');
    expect(keys).not.toContain('createdAt');
    expect(keys).not.toContain('updatedAt');
    expect(keys).not.toContain('searchVector');
  });

  it('does NOT include employer PII (contact persons, phone, email)', () => {
    const companyKeys = Object.keys(card.company);
    expect(companyKeys).not.toContain('phone');
    expect(companyKeys).not.toContain('contactPersons');
    expect(companyKeys).not.toContain('employerUsers');
    expect(companyKeys).not.toContain('rejectionReason');
    expect(companyKeys).not.toContain('suspendedAt');
    expect(companyKeys).not.toContain('approvedAt');
  });
});

// ─────── toJobDetail ──────────────────────────────────────────────────────────

describe('toJobDetail', () => {
  let similar: JobCard[];
  let detail: JobDetail;

  beforeEach(() => {
    similar = [toJobCard(makeCardData({ id: 'job-2', title: 'Plumber' } as Partial<JobCardData>))];
    detail = toJobDetail(makeDetailData(), similar);
  });

  it('includes all card fields', () => {
    expect(detail.id).toBe('job-1');
    expect(detail.humanId).toBe('JB-2026-1');
    expect(detail.salaryMin).toBe(80000);
  });

  it('includes detail-only fields', () => {
    expect(detail.description).toBe('<p>Install electrical systems</p>');
    expect(detail.requirements).toEqual(['3 years experience', 'DEWA license']);
    expect(detail.experienceRequiredYears).toBe(3);
    expect(detail.hoursPerDay).toBe(8);
    expect(detail.daysPerWeek).toBe(6);
    expect(detail.overtime).toBe(false);
    expect(detail.contractPeriodMonths).toBe(24);
    expect(detail.vacancies).toBe(5);
    expect(detail.otherAllowance).toBe('Laundry allowance');
  });

  it('includes extended company info (description, employeeRange)', () => {
    expect(detail.company.description).toBe('Leading construction company');
    expect(detail.company.employeeRange).toBe('501-1000');
    expect(detail.company.isVerified).toBe(true);
  });

  it('embeds similar jobs as JobCard array', () => {
    expect(detail.similar).toHaveLength(1);
    expect(detail.similar[0]!.title).toBe('Plumber');
  });

  it('does NOT include internal fields', () => {
    const keys = Object.keys(detail);
    expect(keys).not.toContain('postedByAdminId');
    expect(keys).not.toContain('autoArchiveAt');
    expect(keys).not.toContain('status');
    expect(keys).not.toContain('searchVector');
  });

  it('coerces null optional fields correctly', () => {
    const d = toJobDetail(
      makeDetailData({
        experienceRequiredYears: null,
        overtimeRateSubunits: null,
        contractPeriodMonths: null,
        vacancies: null,
        genderPreference: null,
        otherAllowance: null,
      } as Partial<JobDetailData>),
      [],
    );
    expect(d.experienceRequiredYears).toBeNull();
    expect(d.overtimeRateSubunits).toBeNull();
    expect(d.contractPeriodMonths).toBeNull();
    expect(d.vacancies).toBeNull();
    expect(d.genderPreference).toBeNull();
    expect(d.otherAllowance).toBeNull();
  });
});
