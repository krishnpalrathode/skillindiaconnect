export const JOB_EVENTS = {
  PUBLISHED: 'job.published',
  PUBLISH_BLOCKED: 'job.publish.blocked',
  PAUSED: 'job.paused',
  ARCHIVED: 'job.archived',
  // S6b-B2: Featured/Urgent flag changes. Exists so the S2-B6 search cache
  // invalidates — a flagged job whose badge doesn't appear in cached results
  // for the TTL window is a real (if self-healing) bug.
  FLAGS_CHANGED: 'job.flags.changed',
} as const;

export interface JobPublishedPayload {
  jobId: string;
  companyId: string;
}

export interface JobPublishBlockedPayload {
  jobId: string;
  companyId: string;
  failedRules: string[];
}

export interface JobPausedPayload {
  jobId: string;
  companyId: string;
  /** Optional machine-readable reason, e.g. "employer_suspended" */
  reason?: string;
}

export interface JobArchivedPayload {
  jobId: string;
  companyId: string;
  /** Optional machine-readable reason, e.g. "auto_archived" */
  reason?: string;
}

export interface JobFlagsChangedPayload {
  jobId: string;
  companyId: string;
  isFeatured: boolean;
  isUrgent: boolean;
}
