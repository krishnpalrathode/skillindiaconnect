export const PROFILE_VIEW_EVENTS = {
  VIEWED: 'profile.viewed',
} as const;

export interface ProfileViewedPayload {
  candidateId: string;
  candidateUserId: string;
  companyId: string;
  companyName: string;
}
