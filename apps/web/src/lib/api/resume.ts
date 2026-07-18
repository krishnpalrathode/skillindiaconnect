import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch } from '@/lib/api/client';

type ResumeSettings = components['schemas']['ResumeSettings'];
type ResumeGeneration = components['schemas']['ResumeGeneration'];

/**
 * The `GET /candidates/me/resume` read — the current Resume Settings, the last
 * render timestamp, and the latest generation (any status, or null when the
 * candidate has never generated). S7-0 folds the optional `/current` endpoint
 * into this single read.
 *
 * The F1 hub uses `settings` to drive the preview's omissions and `current` to
 * offer re-download of an already-READY resume without forcing a regenerate.
 */
export interface ResumeInfo {
  settings: ResumeSettings;
  lastRenderedAt?: string | null;
  current?: ResumeGeneration | null;
}

export function getResume(): Promise<ResumeInfo> {
  return apiFetch<ResumeInfo>('/candidates/me/resume');
}

/**
 * `POST /candidates/me/resume/generate` — 202, status starts PENDING. This ONLY
 * enqueues: the PDF renders worker-side (Chromium, seconds) and the flip to
 * READY is observed by POLLING {@link getResumeStatus}, NEVER synchronously.
 * The settings in effect at this moment are SNAPSHOTTED — a later settings
 * change applies to the NEXT generation, not this one ("regenerate to apply").
 */
export function generateResume(): Promise<{ generationId: string; status: 'PENDING' }> {
  return apiFetch<{ generationId: string; status: 'PENDING' }>('/candidates/me/resume/generate', {
    method: 'POST',
  });
}

/**
 * `GET /candidates/me/resume/status` — THE poll target. PENDING until the
 * worker finishes, then READY (carrying a short-expiry signed download url +
 * the rendered view) or FAILED (carrying a human `failureReason`). 404
 * RESUME_NOT_FOUND when nothing was ever generated. Side-effect-free.
 */
export function getResumeStatus(): Promise<ResumeGeneration> {
  return apiFetch<ResumeGeneration>('/candidates/me/resume/status');
}

/**
 * `GET /candidates/me/resume/download` — re-mints the signed url for the latest
 * READY resume. The signed url is short-lived; call this to refresh an expired
 * link before re-downloading. 404 RESUME_NOT_FOUND when there is no READY
 * resume (the caller then regenerates).
 */
export function getResumeDownloadUrl(): Promise<{ url: string; expiresInSeconds: number }> {
  return apiFetch<{ url: string; expiresInSeconds: number }>('/candidates/me/resume/download');
}
