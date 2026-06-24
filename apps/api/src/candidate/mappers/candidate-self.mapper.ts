import {
  CandidateProfile,
  CandidateSkill,
  Currency,
  MaritalStatus,
  WorkExperience,
} from '@prisma/client';

// ─── DTO shapes returned to the candidate-self viewer ────────────────────────

export interface WorkExperienceDto {
  id: string;
  type: string;
  country: string;
  companyName: string;
  role: string;
  years: number;
  months: number;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
}

export interface CandidateSkillDto {
  id: string;
  name: string;
}

export interface CandidateSelfDto {
  id: string;
  userId: string;
  // Personal info — ALL fields visible to self regardless of privacy toggles
  fullName: string;
  fatherName: string | null;
  dob: string | null;
  phone: string | null;
  phoneVerifiedAt: string | null;
  whatsappCapable: boolean;
  maritalStatus: MaritalStatus | null;
  religion: string | null;
  languages: string[];
  jobCategoryId: string | null;
  photoKey: string | null;
  currentLocation: string | null;
  nationality: string | null;
  noticePeriod: string | null;
  // Salary / availability settings
  salaryExpectationMin: number | null;
  salaryExpectationMax: number | null;
  salaryExpectationCurrency: Currency | null;
  isAvailable: boolean;
  // Privacy toggles
  profileVisible: boolean;
  showPhone: boolean;
  showReligion: boolean;
  waNotifications: boolean;
  emailNotifs: boolean;
  // Completion
  completionPct: number;
  // Relations
  experiences: WorkExperienceDto[];
  skills: CandidateSkillDto[];
  createdAt: string;
  updatedAt: string;
}

// ─── Relation type used by the mapper ────────────────────────────────────────

export type CandidateProfileWithRelations = CandidateProfile & {
  experiences: WorkExperience[];
  skills: CandidateSkill[];
};

// ─── Mapper — single chokepoint for candidate-self serialization ──────────────
// employer / admin / pdf-renderer viewers are separate mappers (S3/S6/S7).

export function toSelf(profile: CandidateProfileWithRelations): CandidateSelfDto {
  return {
    id: profile.id,
    userId: profile.userId,
    fullName: profile.fullName,
    fatherName: profile.fatherName,
    dob: profile.dob ? profile.dob.toISOString().slice(0, 10) : null,
    phone: profile.phone,
    phoneVerifiedAt: profile.phoneVerifiedAt ? profile.phoneVerifiedAt.toISOString() : null,
    whatsappCapable: profile.whatsappCapable,
    maritalStatus: profile.maritalStatus,
    religion: profile.religion,
    languages: profile.languages,
    jobCategoryId: profile.jobCategoryId,
    photoKey: profile.photoKey,
    currentLocation: profile.currentLocation,
    nationality: profile.nationality,
    noticePeriod: profile.noticePeriod,
    salaryExpectationMin: profile.salaryExpectationMin,
    salaryExpectationMax: profile.salaryExpectationMax,
    salaryExpectationCurrency: profile.salaryExpectationCurrency,
    isAvailable: profile.isAvailable,
    profileVisible: profile.profileVisible,
    showPhone: profile.showPhone,
    showReligion: profile.showReligion,
    waNotifications: profile.waNotifications,
    emailNotifs: profile.emailNotifs,
    completionPct: profile.completionPct,
    experiences: profile.experiences.map(mapExperience),
    skills: profile.skills.map(mapSkill),
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function mapExperience(e: WorkExperience): WorkExperienceDto {
  return {
    id: e.id,
    type: e.type,
    country: e.country,
    companyName: e.companyName,
    role: e.role,
    years: e.years,
    months: e.months,
    startDate: e.startDate ? e.startDate.toISOString().slice(0, 10) : null,
    endDate: e.endDate ? e.endDate.toISOString().slice(0, 10) : null,
    createdAt: e.createdAt.toISOString(),
  };
}

function mapSkill(s: CandidateSkill): CandidateSkillDto {
  return { id: s.id, name: s.name };
}
