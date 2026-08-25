import {
  CandidateDocument,
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
  /**
   * The account's OTHER credentials. SELF VIEWER ONLY — the employer and admin
   * mappers are separate functions and none of this reaches them.
   *
   * Onboarding needs these to know which step a candidate is on, and it has to
   * survive a page reload, so the server is the source of truth rather than
   * something the client remembers. A phone-signup account starts with no
   * email and no password and fills both in during onboarding; an email-signup
   * account has both from the start.
   */
  email: string | null;
  emailVerifiedAt: string | null;
  /** Whether a password is set — never the hash, not even to the account owner. */
  hasPassword: boolean;
  /**
   * Whether the account is linked to Google. Onboarding needs this to avoid
   * demanding a password from someone who already has a durable way in: a
   * Google account has no passwordHash either, and hasPassword alone cannot
   * tell the two apart.
   */
  hasGoogle: boolean;
  maritalStatus: MaritalStatus | null;
  religion: string | null;
  languages: string[];
  jobCategoryId: string | null;
  /**
   * Short-expiry SIGNED url for the profile photo (never the raw R2 key), or
   * null when no photo is uploaded. Signed by the service layer — the mapper is
   * pure, so the caller passes the already-signed url in.
   */
  photoUrl: string | null;
  currentLocation: string | null;
  nationality: string | null;
  noticePeriod: number | null;
  summary: string | null;
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
  documents: CandidateDocumentDto[];
  createdAt: string;
  updatedAt: string;
}

/** Mirrors the contract's CandidateDocument (self viewer). */
export interface CandidateDocumentDto {
  id: string;
  type: string;
  key: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  uploadedAt: string;
  expiryDate: string | null;
}

// ─── Relation type used by the mapper ────────────────────────────────────────

export type CandidateProfileWithRelations = CandidateProfile & {
  /**
   * Optional so the lighter-include callers stay as they are. When absent the
   * mapper reports no email and no password rather than guessing — the callers
   * that omit it (PATCH responses, the availability toggle) are not the ones
   * driving onboarding.
   */
  user?: {
    email: string | null;
    emailVerifiedAt: Date | null;
    passwordHash: string | null;
    googleId: string | null;
  };
  experiences: WorkExperience[];
  skills: CandidateSkill[];
  /**
   * Optional so the callers that don't need documents (PATCH responses, the
   * availability toggle) can keep their lighter include. When absent the mapper
   * emits an empty list rather than inventing rows.
   */
  documents?: CandidateDocument[];
};

// ─── Mapper — single chokepoint for candidate-self serialization ──────────────
// employer / admin / pdf-renderer viewers are separate mappers (S3/S6/S7).

export function toSelf(
  profile: CandidateProfileWithRelations,
  // Defaults to null so callers that don't serve a photo (and unit tests) stay
  // terse; the candidate.service passes the signed url explicitly.
  photoUrl: string | null = null,
): CandidateSelfDto {
  return {
    id: profile.id,
    userId: profile.userId,
    fullName: profile.fullName,
    fatherName: profile.fatherName,
    dob: profile.dob ? profile.dob.toISOString().slice(0, 10) : null,
    phone: profile.phone,
    phoneVerifiedAt: profile.phoneVerifiedAt ? profile.phoneVerifiedAt.toISOString() : null,
    email: profile.user?.email ?? null,
    emailVerifiedAt: profile.user?.emailVerifiedAt
      ? profile.user.emailVerifiedAt.toISOString()
      : null,
    // Boolean only. The hash never leaves the server, for any viewer.
    hasPassword: Boolean(profile.user?.passwordHash),
    hasGoogle: Boolean(profile.user?.googleId),
    whatsappCapable: profile.whatsappCapable,
    maritalStatus: profile.maritalStatus,
    religion: profile.religion,
    languages: profile.languages,
    jobCategoryId: profile.jobCategoryId,
    photoUrl,
    currentLocation: profile.currentLocation,
    nationality: profile.nationality,
    noticePeriod: profile.noticePeriod,
    summary: profile.summary,
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
    documents: (profile.documents ?? []).map(mapDocument),
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

/**
 * The candidate's OWN documents. `key` is included here on purpose — the
 * contract's CandidateDocument carries it for the self viewer, and the UI shows
 * the file name derived from it. The employer and admin viewers use separate
 * mappers that expose status only, never the key.
 *
 * `status` is always PENDING: candidate documents have no verification
 * workflow (unlike CompanyDocument, which stores verifiedAt/verifiedById), so
 * there is no stored state to report. Claiming VERIFIED here would be a lie to
 * both the candidate and the admin queue.
 */
function mapDocument(d: CandidateDocument): CandidateDocumentDto {
  return {
    id: d.id,
    type: d.type,
    key: d.r2Key,
    status: 'PENDING',
    uploadedAt: d.uploadedAt.toISOString(),
    expiryDate: d.expiryDate ? d.expiryDate.toISOString().slice(0, 10) : null,
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
