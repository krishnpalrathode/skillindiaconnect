export const EMPLOYER_EVENTS = {
  APPROVED: 'employer.approved',
  REJECTED: 'employer.rejected',
  SUSPENDED: 'employer.suspended',
  REACTIVATED: 'employer.reactivated',
} as const;

export interface EmployerApprovedPayload {
  companyId: string;
  companyName: string;
  /** userId of the primary employer user — used by B3 to create their notification */
  userId: string;
}

export interface EmployerRejectedPayload {
  companyId: string;
  companyName: string;
  userId: string;
  reason: string;
}

export interface EmployerSuspendedPayload {
  companyId: string;
  companyName: string;
  userId: string;
}

export interface EmployerReactivatedPayload {
  companyId: string;
  companyName: string;
  userId: string;
}
