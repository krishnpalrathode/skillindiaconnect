import { ApplicationStatus } from '@prisma/client';

/**
 * Applications domain events (EventEmitter2, same-process).
 *
 * B1 emits `application.created`; B2 adds `application.status.changed` on every
 * transition (employer forward-only + admin override).
 */
export const APPLICATION_EVENTS = {
  CREATED: 'application.created',
  STATUS_CHANGED: 'application.status.changed',
} as const;

export interface ApplicationCreatedPayload {
  applicationId: string;
  jobId: string;
  candidateId: string;
  companyId: string;
}

/**
 * Emitted post-commit on every status transition. `overrideReason` is
 * DELIBERATELY ABSENT — it is admin/audit-facing only and must never reach a
 * candidate-facing reaction. `isAdminOverride` flags the admin corrective path.
 */
export interface ApplicationStatusChangedPayload {
  applicationId: string;
  jobId: string;
  candidateId: string | null;
  fromStatus: ApplicationStatus;
  toStatus: ApplicationStatus;
  isAdminOverride: boolean;
}
