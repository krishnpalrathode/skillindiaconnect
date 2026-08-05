import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch } from '@/lib/api/client';

type ResumeSettings = components['schemas']['ResumeSettings'];
type ResumeGeneration = components['schemas']['ResumeGeneration'];
type ResumeDeliveryResult = components['schemas']['ResumeDeliveryResult'];

/** The editable subset of `ResumeSettings` (S7-F2 toggles + language + CR-001 template). */
export type ResumeSettingsPatch = Partial<
  Pick<
    ResumeSettings,
    'language' | 'showPhone' | 'showReligion' | 'showFatherName' | 'showPassportNumber' | 'template'
  >
>;

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

/**
 * `PATCH /candidates/me/resume/settings` — update the resume toggles/language and
 * get back the FULL resulting settings. Settings apply at GENERATION: this does
 * NOT alter an already-generated PDF (the caller prompts "regenerate to apply").
 * `language` is English-only at MVP — the API 400s any other value.
 */
export function patchResumeSettings(body: ResumeSettingsPatch): Promise<ResumeSettings> {
  return apiFetch<ResumeSettings>('/candidates/me/resume/settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * `POST /candidates/me/resume/send-whatsapp` — enqueue the resume to the
 * candidate's OWN verified number. The honest B2 contract, three outcomes:
 *   - 202 `{ delivered: 'WHATSAPP' }`       — queued to WhatsApp.
 *   - 202 `{ delivered: 'EMAIL_FALLBACK' }` — NOT whatsapp-capable → emailed to
 *     self instead (a 202, NOT an error — but the UI must say so plainly).
 *   - 422 `RESUME_NOT_READY`                — no READY resume yet (generate first).
 *   - 429 `RESUME_SEND_LIMIT_EXCEEDED`      — today's 5-send cap reached.
 * The non-202s throw `ApiRequestError`; the caller maps `error.code` to copy.
 */
export function sendResumeWhatsApp(): Promise<ResumeDeliveryResult> {
  return apiFetch<ResumeDeliveryResult>('/candidates/me/resume/send-whatsapp', {
    method: 'POST',
  });
}

/**
 * `POST /candidates/me/resume/send-email` — email the resume to the candidate's
 * OWN account email (never an arbitrary address). 202 `{ delivered: 'EMAIL' }`;
 * 422 `RESUME_NOT_READY` handled like the WhatsApp path. No dedicated cap.
 */
export function emailResume(): Promise<ResumeDeliveryResult> {
  return apiFetch<ResumeDeliveryResult>('/candidates/me/resume/send-email', {
    method: 'POST',
  });
}
