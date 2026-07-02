/**
 * Public-schema subset for job search + detail endpoints.
 *
 * DATA-LAYER PRIVACY BOUNDARY: the mapper and select objects in this file
 * define exactly what fields are visible to unauthenticated public consumers.
 * Never add employer PII (contact persons, email, phone, employerUser info) or
 * internal fields (postedByAdminId, autoArchiveAt, pausedAt, archivedAt, searchVector).
 * Only ACTIVE jobs reach this mapper (enforced upstream in the service).
 */
import { CompanyStatus, Currency, EmploymentType, JobMarket, Prisma } from '@prisma/client';

// ─────── Prisma select objects (define the privacy boundary) ─────────────────

export const JOB_CARD_SELECT = {
  id: true,
  humanId: true,
  title: true,
  market: true,
  location: true,
  employmentType: true,
  categoryId: true,
  salaryMin: true,
  salaryMax: true,
  currency: true,
  accommodation: true,
  healthInsurance: true,
  transportation: true,
  foodAllowance: true,
  airTicketArrival: true,
  airTicketDeparture: true,
  isFeatured: true,
  isUrgent: true,
  publishedAt: true,
  viewsCount: true,
  companyId: true,
  category: {
    select: {
      slug: true,
      nameEn: true,
      nameHi: true,
      nameAr: true,
    },
  },
  company: {
    select: {
      id: true,
      name: true,
      status: true,
      industryType: true,
      location: true,
    },
  },
} as const;

export const JOB_DETAIL_SELECT = {
  id: true,
  humanId: true,
  title: true,
  market: true,
  location: true,
  employmentType: true,
  categoryId: true,
  salaryMin: true,
  salaryMax: true,
  currency: true,
  accommodation: true,
  healthInsurance: true,
  transportation: true,
  foodAllowance: true,
  airTicketArrival: true,
  airTicketDeparture: true,
  otherAllowance: true,
  isFeatured: true,
  isUrgent: true,
  publishedAt: true,
  viewsCount: true,
  companyId: true,
  description: true,
  requirements: true,
  experienceRequiredYears: true,
  hoursPerDay: true,
  daysPerWeek: true,
  overtime: true,
  overtimeRateSubunits: true,
  contractPeriodMonths: true,
  vacancies: true,
  genderPreference: true,
  category: {
    select: {
      slug: true,
      nameEn: true,
      nameHi: true,
      nameAr: true,
    },
  },
  company: {
    select: {
      id: true,
      name: true,
      status: true,
      industryType: true,
      location: true,
      description: true,
      employeeRange: true,
    },
  },
} as const;

export type JobCardData = Prisma.JobGetPayload<{ select: typeof JOB_CARD_SELECT }>;
export type JobDetailData = Prisma.JobGetPayload<{ select: typeof JOB_DETAIL_SELECT }>;

// ─────── Public output types ──────────────────────────────────────────────────

export interface PublicCompany {
  id: string;
  name: string;
  isVerified: boolean;
  industryType: string;
  location: string;
}

export interface PublicCompanyDetail extends PublicCompany {
  description: string | null;
  employeeRange: string;
}

export interface PublicCategory {
  slug: string;
  nameEn: string;
  nameHi: string | null;
  nameAr: string | null;
}

export interface JobCard {
  id: string;
  humanId: string;
  title: string;
  market: JobMarket;
  location: string;
  employmentType: EmploymentType;
  category: PublicCategory;
  salaryMin: number;
  salaryMax: number;
  currency: Currency;
  accommodation: boolean;
  healthInsurance: boolean;
  transportation: boolean;
  foodAllowance: boolean;
  airTicketArrival: boolean;
  airTicketDeparture: boolean;
  isFeatured: boolean;
  isUrgent: boolean;
  publishedAt: Date | null;
  viewsCount: number;
  company: PublicCompany;
}

export interface JobDetail extends Omit<JobCard, 'company'> {
  description: string;
  requirements: string[];
  experienceRequiredYears: number | null;
  hoursPerDay: number;
  daysPerWeek: number;
  overtime: boolean;
  overtimeRateSubunits: number | null;
  contractPeriodMonths: number | null;
  vacancies: number | null;
  genderPreference: string | null;
  otherAllowance: string | null;
  company: PublicCompanyDetail;
  similar: JobCard[];
}

// ─────── Mapper functions ─────────────────────────────────────────────────────

export function toJobCard(job: JobCardData): JobCard {
  return {
    id: job.id,
    humanId: job.humanId,
    title: job.title,
    market: job.market,
    location: job.location,
    employmentType: job.employmentType,
    category: {
      slug: job.category.slug,
      nameEn: job.category.nameEn,
      nameHi: job.category.nameHi ?? null,
      nameAr: job.category.nameAr ?? null,
    },
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    currency: job.currency,
    accommodation: job.accommodation,
    healthInsurance: job.healthInsurance,
    transportation: job.transportation,
    foodAllowance: job.foodAllowance,
    airTicketArrival: job.airTicketArrival,
    airTicketDeparture: job.airTicketDeparture,
    isFeatured: job.isFeatured,
    isUrgent: job.isUrgent,
    publishedAt: job.publishedAt,
    viewsCount: job.viewsCount,
    company: {
      id: job.company.id,
      name: job.company.name,
      isVerified: job.company.status === CompanyStatus.APPROVED,
      industryType: job.company.industryType,
      location: job.company.location,
    },
  };
}

export function toJobDetail(job: JobDetailData, similar: JobCard[]): JobDetail {
  return {
    id: job.id,
    humanId: job.humanId,
    title: job.title,
    market: job.market,
    location: job.location,
    employmentType: job.employmentType,
    category: {
      slug: job.category.slug,
      nameEn: job.category.nameEn,
      nameHi: job.category.nameHi ?? null,
      nameAr: job.category.nameAr ?? null,
    },
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    currency: job.currency,
    accommodation: job.accommodation,
    healthInsurance: job.healthInsurance,
    transportation: job.transportation,
    foodAllowance: job.foodAllowance,
    airTicketArrival: job.airTicketArrival,
    airTicketDeparture: job.airTicketDeparture,
    isFeatured: job.isFeatured,
    isUrgent: job.isUrgent,
    publishedAt: job.publishedAt,
    viewsCount: job.viewsCount,
    description: job.description,
    requirements: job.requirements as string[],
    experienceRequiredYears: job.experienceRequiredYears ?? null,
    hoursPerDay: job.hoursPerDay,
    daysPerWeek: job.daysPerWeek,
    overtime: job.overtime,
    overtimeRateSubunits: job.overtimeRateSubunits ?? null,
    contractPeriodMonths: job.contractPeriodMonths ?? null,
    vacancies: job.vacancies ?? null,
    genderPreference: job.genderPreference ?? null,
    otherAllowance: job.otherAllowance ?? null,
    company: {
      id: job.company.id,
      name: job.company.name,
      isVerified: job.company.status === CompanyStatus.APPROVED,
      industryType: job.company.industryType,
      location: job.company.location,
      description: job.company.description ?? null,
      employeeRange: job.company.employeeRange,
    },
    similar,
  };
}
