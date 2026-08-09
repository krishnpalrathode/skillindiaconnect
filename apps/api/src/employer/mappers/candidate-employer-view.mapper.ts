import { DocumentType } from '@prisma/client';
import { CandidateForEmployerView } from '../../candidate/candidate-read.service';

// ── Output shapes (match frozen S3-0 spec: CandidateEmployerView) ─────────────

export interface ExperienceViewDto {
  id: string;
  type: string;
  country: string;
  companyName: string;
  role: string;
  years: number;
  months: number;
  startDate: string | null;
  endDate: string | null;
}

export interface DocumentStatusDto {
  type: string;
  uploaded: boolean;
  passportValid?: boolean; // Only set for PASSPORT type
}

export interface CandidateEmployerViewDto {
  id: string;
  fullName: string;
  photo: string | null;
  age: number | null;
  jobCategory: string | null;
  currentLocation: string | null;
  nationality: string | null;
  languages: string[];
  noticePeriod: number | null;
  isAvailable: boolean;
  experiences: ExperienceViewDto[];
  skills: { id: string; name: string }[];
  salaryExpectation: { min: number | null; max: number | null; currency: string | null } | null;
  completionPct: number;
  memberSince: string;
  documentsStatus: DocumentStatusDto[];
  // Conditionally ABSENT (key does not exist) — not null — when toggle is false
  phone?: string;
  religion?: string;
  /** Whether the VIEWING company has shortlisted them (set by the service,
   *  not the mapper — the mapper stays viewer-agnostic). */
  isInterested?: boolean;
  /** Whether that company has already sent them the outreach message. */
  interestNotified?: boolean;
}

// Source type passed by the service (adds pre-resolved photoUrl)
export interface EmployerViewSource extends CandidateForEmployerView {
  photoUrl: string | null;
}

// Mandatory document types for status reporting
const MANDATORY_DOC_TYPES = [
  DocumentType.PASSPORT,
  DocumentType.EXPERIENCE_CERT,
  DocumentType.EDUCATIONAL_CERT,
] as const;

// ── Mapper ────────────────────────────────────────────────────────────────────

/**
 * THE privacy chokepoint for employer → candidate serialization.
 *
 * Invariants (tested on raw JSON.stringify output, not rendered UI):
 * - showPhone=false  → 'phone' KEY IS ABSENT from the returned object.
 * - showReligion=false → 'religion' KEY IS ABSENT.
 * - dob NEVER appears in ANY output shape — age is derived then dob is dropped.
 * - documentsStatus: booleans only; no r2Key, url, fileName, or mimeType.
 * - Toggle values (showPhone, showReligion) never serialized.
 */
export function toEmployerView(source: EmployerViewSource): CandidateEmployerViewDto {
  const now = new Date();

  return {
    id: source.id,
    fullName: source.fullName,
    photo: source.photoUrl,
    age: computeAge(source.dob),
    jobCategory: source.jobCategoryId,
    currentLocation: source.currentLocation,
    nationality: source.nationality,
    languages: source.languages,
    noticePeriod: source.noticePeriod,
    isAvailable: source.isAvailable,
    experiences: source.experiences.map(mapExperience),
    skills: source.skills,
    salaryExpectation:
      source.salaryExpectationMin != null || source.salaryExpectationMax != null
        ? {
            min: source.salaryExpectationMin,
            max: source.salaryExpectationMax,
            currency: source.salaryExpectationCurrency,
          }
        : null,
    completionPct: source.completionPct,
    memberSince: source.createdAt.toISOString(),
    documentsStatus: buildDocumentStatus(source.documents, now),
    // Conditional spread — key is ABSENT (not null/undefined) when toggle is false.
    // Verified by 'phone' in JSON.parse(JSON.stringify(dto)) === false when showPhone=false.
    ...(source.showPhone && source.phone != null && { phone: source.phone }),
    ...(source.showReligion && source.religion != null && { religion: source.religion }),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeAge(dob: Date | null): number | null {
  if (!dob) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

function mapExperience(e: EmployerViewSource['experiences'][number]): ExperienceViewDto {
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
  };
}

function buildDocumentStatus(
  documents: { type: DocumentType; expiryDate: Date | null }[],
  now: Date,
): DocumentStatusDto[] {
  const docMap = new Map(documents.map((d) => [d.type, d]));

  return MANDATORY_DOC_TYPES.map((type): DocumentStatusDto => {
    const doc = docMap.get(type);
    if (!doc) {
      return { type, uploaded: false };
    }
    if (type === DocumentType.PASSPORT) {
      // Valid if no expiry date, or expiry date is in the future
      const passportValid = doc.expiryDate == null || doc.expiryDate >= now;
      return { type, uploaded: true, passportValid };
    }
    return { type, uploaded: true };
  });
}
