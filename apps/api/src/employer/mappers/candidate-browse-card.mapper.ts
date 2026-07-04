import { CandidateBrowseSource } from '../../candidate/candidate-read.service';

// ── Output shape (frozen S3-0 spec: CandidateBrowseCard) ──────────────────────

export interface CandidateBrowseCardDto {
  id: string;
  fullName: string;
  photo: string | null;
  jobCategory: string | null;
  currentLocation: string | null;
  totalExperienceYears: number;
  hasForeignExperience: boolean;
  skills: string[]; // top ≤3 skill names
  isAvailable: boolean;
  completionPct: number;
}

// Source type passed by the service (adds pre-resolved photoUrl)
export interface BrowseCardSource extends CandidateBrowseSource {
  photoUrl: string | null;
}

/**
 * Maps browse-query source rows to the CandidateBrowseCard shape.
 *
 * Phone, religion, salary, and documents are NOT in the card schema by design —
 * their absence is structural, not conditional. No toggle checks needed here.
 */
export function toBrowseCard(source: BrowseCardSource): CandidateBrowseCardDto {
  return {
    id: source.id,
    fullName: source.fullName,
    photo: source.photoUrl,
    jobCategory: source.jobCategoryId,
    currentLocation: source.currentLocation,
    // Round to 1 decimal for display; preserves fractional experience (e.g. 2.5 years)
    totalExperienceYears: Math.round(source.totalExperienceYears * 10) / 10,
    hasForeignExperience: source.hasForeignExperience,
    skills: source.skills.slice(0, 3).map((s) => s.name),
    isAvailable: source.isAvailable,
    completionPct: source.completionPct,
  };
}
