export const CANDIDATE_EVENTS = {
  PROFILE_UPDATED: 'candidate.profile.updated',
  EXPERIENCE_CHANGED: 'candidate.experience.changed',
  SKILL_CHANGED: 'candidate.skill.changed',
  // Emitted by S1-3 on document confirm/delete; this module listens.
  DOCUMENT_CHANGED: 'candidate.document.changed',
} as const;

export interface CandidateChangedPayload {
  candidateId: string;
}
