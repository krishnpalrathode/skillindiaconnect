import { ApplicationStatus } from '@prisma/client';

/**
 * The application state machine as DATA (not scattered conditionals).
 *
 * The transition core consults these tables; the exhaustive matrix tests ITERATE
 * them (every legal AND illegal cell), so the rules and their tests never drift.
 *
 * There is NO `WITHDRAWN` state at MVP.
 */

/**
 * Employer moves are FORWARD-ONLY. Skip-to-SELECTED from PENDING is allowed.
 * SELECTED and REJECTED are terminal for employers. Same-state is never listed →
 * a same-state move is ILLEGAL for the employer (as it is for the admin).
 */
export const EMPLOYER_LEGAL: Record<ApplicationStatus, ApplicationStatus[]> = {
  [ApplicationStatus.PENDING]: [
    ApplicationStatus.SHORTLISTED,
    ApplicationStatus.SELECTED,
    ApplicationStatus.REJECTED,
  ],
  [ApplicationStatus.SHORTLISTED]: [ApplicationStatus.SELECTED, ApplicationStatus.REJECTED],
  [ApplicationStatus.SELECTED]: [],
  [ApplicationStatus.REJECTED]: [],
};

const ALL_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.PENDING,
  ApplicationStatus.SHORTLISTED,
  ApplicationStatus.SELECTED,
  ApplicationStatus.REJECTED,
];

/**
 * Admins may move to ANY status EXCEPT the current one (a corrective/backward
 * move). Same-state is illegal for admins too.
 */
export const ADMIN_LEGAL: Record<ApplicationStatus, ApplicationStatus[]> = ALL_STATUSES.reduce(
  (acc, from) => {
    acc[from] = ALL_STATUSES.filter((to) => to !== from);
    return acc;
  },
  {} as Record<ApplicationStatus, ApplicationStatus[]>,
);

export type ActorType = 'EMPLOYER' | 'ADMIN';

/** The legal destination set for a given actor + current status. */
export function allowedTransitions(
  actorType: ActorType,
  from: ApplicationStatus,
): ApplicationStatus[] {
  return actorType === 'ADMIN' ? ADMIN_LEGAL[from] : EMPLOYER_LEGAL[from];
}

export function isLegalTransition(
  actorType: ActorType,
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  return allowedTransitions(actorType, from).includes(to);
}
