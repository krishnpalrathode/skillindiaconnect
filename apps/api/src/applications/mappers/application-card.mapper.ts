import { Application, ApplicationStatus, ApplicationTimelineEntry, UserRole } from '@prisma/client';
import { JobSubset } from '../../jobs/jobs.service';
import { MatchBreakdown } from '../match/match.compute';

/**
 * Candidate-facing application read shapes (frozen S4-0). The job block is the
 * public-safe subset resolved via JobsService — never the raw job row.
 */
export interface ApplicationCardDto {
  id: string;
  humanId: string;
  job: JobSubset;
  status: ApplicationStatus;
  matchScore: number;
  appliedAt: string;
  selectedNotifiedAt: string | null;
  rejectionFeedback: string | null;
}

/**
 * A candidate-facing timeline entry. `overrideReason` and `actorUserId` are
 * DELIBERATELY EXCLUDED (admin/audit-only, actor IDENTITY never leaked). Proven on
 * raw JSON — the keys must be ABSENT, not null.
 */
export interface TimelineEntryDto {
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  actorRole: UserRole | null;
  isAdminOverride: boolean;
  createdAt: string;
}

export interface ApplicationDetailDto extends ApplicationCardDto {
  matchBreakdown: MatchBreakdown;
  coverLetter: string | null;
  timeline: TimelineEntryDto[];
}

const UNKNOWN_JOB: Omit<JobSubset, 'id'> = {
  title: '(unavailable)',
  companyName: '',
  location: '',
  market: 'GULF',
};

export function toApplicationCard(
  app: Application,
  job: JobSubset | undefined,
): ApplicationCardDto {
  return {
    id: app.id,
    humanId: app.humanId,
    job: job ?? { id: app.jobId, ...UNKNOWN_JOB },
    status: app.status,
    matchScore: app.matchScore,
    appliedAt: app.createdAt.toISOString(),
    selectedNotifiedAt: app.selectedNotifiedAt?.toISOString() ?? null,
    rejectionFeedback: app.rejectionFeedback,
  };
}

/** Shapes a timeline row for the candidate — drops overrideReason + actorUserId. */
export function toTimelineEntry(e: ApplicationTimelineEntry): TimelineEntryDto {
  return {
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    actorRole: e.actorRole,
    isAdminOverride: e.isAdminOverride,
    createdAt: e.createdAt.toISOString(),
    // overrideReason + actorUserId intentionally OMITTED.
  };
}

export function toApplicationDetail(
  app: Application,
  job: JobSubset | undefined,
  timeline: ApplicationTimelineEntry[],
): ApplicationDetailDto {
  return {
    ...toApplicationCard(app, job),
    matchBreakdown: app.matchBreakdown as unknown as MatchBreakdown,
    coverLetter: app.coverLetter,
    timeline: timeline.map(toTimelineEntry),
  };
}
