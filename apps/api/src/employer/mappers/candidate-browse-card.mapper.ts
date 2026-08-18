import { CandidateBrowseSource } from '../../candidate/candidate-read.service';
import { activityStatusFor, type ActivityStatus } from '../../candidate/activity.constants';

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
  /**
   * How recently the candidate actually used the platform.
   *
   * DISTINCT from `isAvailable`, and both are shown on purpose. `isAvailable`
   * is what the candidate SAYS — a toggle they set once and may never revisit.
   * This is what they DO. A profile that says "available" and has not been
   * opened since spring is the exact combination an employer wastes a phone
   * call on, and until now nothing on the card distinguished it from a
   * candidate who logged in this morning.
   */
  activityStatus: ActivityStatus;
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
    // Computed at READ time from lastLoginAt rather than stored: a persisted
    // bucket would need a cron to age it and would be wrong between runs.
    activityStatus: activityStatusFor(source.user?.lastLoginAt ?? null),
    completionPct: source.completionPct,
  };
}
