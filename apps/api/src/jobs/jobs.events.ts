export const JOB_EVENTS = {
  PUBLISHED: 'job.published',
  PUBLISH_BLOCKED: 'job.publish.blocked',
  PAUSED: 'job.paused',
  ARCHIVED: 'job.archived',
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
