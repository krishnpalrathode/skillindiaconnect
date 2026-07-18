import { Application } from '@prisma/client';
import { MatchBreakdown } from './match/match.compute';

/**
 * Candidate-context Application response — the frozen S4-0 shape.
 *
 * `overrideReason` is DELIBERATELY absent (admin-context-only, B2). `appliedAt`
 * is the row's createdAt. matchScore/matchBreakdown are the immutable snapshot.
 */
export interface ApplicationResponse {
  id: string;
  humanId: string;
  jobId: string;
  candidateId: string;
  status: Application['status'];
  matchScore: number;
  matchBreakdown: MatchBreakdown;
  coverLetter: string | null;
  docsCompleteCount: number;
  docsRequiredCount: number;
  passportValidAtApply: boolean;
  selectedNotifiedAt: string | null;
  rejectionFeedback: string | null;
  appliedAt: string;
  updatedAt: string;
}

export function toApplicationResponse(row: Application): ApplicationResponse {
  return {
    id: row.id,
    humanId: row.humanId,
    jobId: row.jobId,
    // candidateId is non-null for a freshly-created application (tombstone is a
    // later GDPR-delete concern, not reachable on the apply path).
    candidateId: row.candidateId as string,
    status: row.status,
    matchScore: row.matchScore,
    matchBreakdown: row.matchBreakdown as unknown as MatchBreakdown,
    coverLetter: row.coverLetter,
    docsCompleteCount: row.docsCompleteCount,
    docsRequiredCount: row.docsRequiredCount,
    passportValidAtApply: row.passportValidAtApply,
    selectedNotifiedAt: row.selectedNotifiedAt?.toISOString() ?? null,
    rejectionFeedback: row.rejectionFeedback,
    appliedAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
