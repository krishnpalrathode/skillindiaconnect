/**
 * Applications domain events (EventEmitter2, same-process).
 *
 * B1 emits only `application.created`. Status-change events (SHORTLISTED/SELECTED/
 * REJECTED, admin override) arrive in B2.
 */
export const APPLICATION_EVENTS = {
  CREATED: 'application.created',
} as const;

export interface ApplicationCreatedPayload {
  applicationId: string;
  jobId: string;
  candidateId: string;
  companyId: string;
}
