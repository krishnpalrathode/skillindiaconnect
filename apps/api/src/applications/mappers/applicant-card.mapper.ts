import { Application } from '@prisma/client';
import { CandidateEmployerViewDto } from '../../employer/mappers/candidate-employer-view.mapper';
import { MatchBreakdown } from '../match/match.compute';

/**
 * ApplicantCard = the S3-B2 employer-context candidate subset (produced by
 * `toEmployerView`, the privacy chokepoint) COMPOSED with the application's own
 * snapshot fields. We do NOT re-implement the candidate serialization — the read
 * service calls `toEmployerView` and hands its output here, so the phone/religion
 * omission, no-dob, and docs-status-only invariants are INHERITED, not re-derived.
 *
 * `matchBreakdown` is the immutable apply-time SNAPSHOT — never recomputed from
 * the candidate's current profile.
 */
export type ApplicantCardDto = CandidateEmployerViewDto & {
  applicationId: string;
  humanId: string;
  status: Application['status'];
  matchScore: number;
  matchBreakdown: MatchBreakdown;
  coverLetter: string | null;
  appliedAt: string;
  docsCompleteCount: number;
  docsRequiredCount: number;
  passportValidAtApply: boolean;
};

/**
 * Tombstone-safe minimal candidate block for a purged/anonymized application
 * (null candidateId or a candidate row that no longer exists). B1 always sets
 * candidateId, so this is defensive — but the schema allows nulls, so the mapper
 * must not crash. Renders a neutral, PII-free placeholder subject.
 */
function tombstoneCandidate(candidateId: string | null): CandidateEmployerViewDto {
  return {
    id: candidateId ?? '',
    fullName: '(unavailable)',
    photo: null,
    age: null,
    jobCategory: null,
    currentLocation: null,
    nationality: null,
    languages: [],
    noticePeriod: null,
    isAvailable: false,
    experiences: [],
    skills: [],
    salaryExpectation: null,
    completionPct: 0,
    memberSince: new Date(0).toISOString(),
    documentsStatus: [],
  };
}

export function toApplicantCard(
  app: Application,
  candidateView: CandidateEmployerViewDto | undefined,
): ApplicantCardDto {
  const subject = candidateView ?? tombstoneCandidate(app.candidateId);
  return {
    ...subject,
    applicationId: app.id,
    humanId: app.humanId,
    status: app.status,
    matchScore: app.matchScore,
    matchBreakdown: app.matchBreakdown as unknown as MatchBreakdown,
    coverLetter: app.coverLetter,
    appliedAt: app.createdAt.toISOString(),
    docsCompleteCount: app.docsCompleteCount,
    docsRequiredCount: app.docsRequiredCount,
    passportValidAtApply: app.passportValidAtApply,
  };
}
