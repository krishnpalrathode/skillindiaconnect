import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch } from '@/lib/api/client';

type Application = components['schemas']['Application'];
type ApplicationCard = components['schemas']['ApplicationCard'];

export interface ApplyBody {
  /** Optional cover letter, ≤500 chars (server-enforced; client blocks over-limit too). */
  coverLetter?: string;
}

/**
 * POST /jobs/{id}/apply. Resolves to the created Application (match snapshot +
 * humanId). Rejects with ApiRequestError carrying the gate code + meta on failure
 * (JOB_NOT_ACTIVE / ALREADY_APPLIED / PROFILE_INCOMPLETE / MANDATORY_DOCS_MISSING /
 * PASSPORT_INVALID) — the caller maps those to actionable UI. The server is the
 * source of truth; the client eligibility preview never substitutes for it.
 */
export function applyToJob(jobId: string, body: ApplyBody): Promise<Application> {
  return apiFetch<Application>(`/jobs/${jobId}/apply`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Whether the candidate has already applied to this job — the "Applied ✓" signal
 * that must SURVIVE REVISITS. Mechanism: scan the candidate's applications feed
 * for a card whose `job.id` matches. (The 409 on submit is the same-session
 * guarantee; this is the on-load one.) Returns the matching card, or null.
 */
export async function getMyApplicationForJob(jobId: string): Promise<ApplicationCard | null> {
  // apiFetch unwraps the envelope's `.data`, so the cursor feed `{ data, nextCursor }`
  // resolves to the ApplicationCard[] (nextCursor is not needed for this check).
  const cards = await apiFetch<ApplicationCard[]>('/candidates/me/applications?limit=100');
  return cards.find((c) => c.job.id === jobId) ?? null;
}
