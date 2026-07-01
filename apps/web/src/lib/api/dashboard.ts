import { apiFetch } from './client';

export interface CandidateStats {
  applied: number;
  profileViews: number;
  shortlisted: number;
}

export function getCandidateStats(): Promise<CandidateStats> {
  return apiFetch<CandidateStats>('/candidates/me/stats');
}
