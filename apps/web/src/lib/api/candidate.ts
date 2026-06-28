import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch } from '@/lib/api/client';

type CandidateProfile = components['schemas']['CandidateProfile'];
type WorkExperience = components['schemas']['WorkExperience'];
type CandidateSkill = components['schemas']['CandidateSkill'];
type CandidateDocument = components['schemas']['CandidateDocument'];
type CompletionResult = components['schemas']['CompletionResult'];

export type PatchCandidateBody = Partial<
  Pick<
    CandidateProfile,
    | 'fullName'
    | 'fatherName'
    | 'dob'
    | 'maritalStatus'
    | 'languages'
    | 'jobCategoryId'
    | 'currentLocation'
    | 'nationality'
    | 'noticePeriod'
    | 'religion'
    | 'profileVisible'
    | 'isAvailable'
    | 'salaryExpectationMin'
    | 'salaryExpectationMax'
    | 'salaryExpectationCurrency'
  >
>;

export function getCandidateProfile(): Promise<CandidateProfile> {
  return apiFetch<CandidateProfile>('/candidates/me');
}

export function patchCandidateProfile(body: PatchCandidateBody): Promise<CandidateProfile> {
  return apiFetch<CandidateProfile>('/candidates/me', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function getCandidateCompletion(): Promise<CompletionResult> {
  return apiFetch<CompletionResult>('/candidates/me/completion');
}

export function postCompleteOnboarding(): Promise<{ completionPct: number }> {
  return apiFetch<{ completionPct: number }>('/candidates/me/complete-onboarding', {
    method: 'POST',
  });
}

// ─── Experiences ──────────────────────────────────────────────────────────────

export type CreateExperienceBody = Omit<WorkExperience, 'id'>;

export function postExperience(body: CreateExperienceBody): Promise<WorkExperience> {
  return apiFetch<WorkExperience>('/candidates/me/experiences', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function patchExperience(
  id: string,
  body: Partial<CreateExperienceBody>,
): Promise<WorkExperience> {
  return apiFetch<WorkExperience>(`/candidates/me/experiences/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteExperience(id: string): Promise<void> {
  return apiFetch<void>(`/candidates/me/experiences/${id}`, { method: 'DELETE' });
}

// ─── Skills ───────────────────────────────────────────────────────────────────

export function postSkill(name: string): Promise<CandidateSkill> {
  return apiFetch<CandidateSkill>('/candidates/me/skills', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function deleteSkill(id: string): Promise<void> {
  return apiFetch<void>(`/candidates/me/skills/${id}`, { method: 'DELETE' });
}

// ─── Documents ────────────────────────────────────────────────────────────────

export interface PresignRequest {
  type: 'PASSPORT' | 'EXPERIENCE_CERT' | 'EDUCATIONAL_CERT';
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface PresignResponse {
  uploadUrl: string;
  key: string;
  expiresInSeconds: number;
}

export function presignDocument(body: PresignRequest): Promise<PresignResponse> {
  return apiFetch<PresignResponse>('/candidates/me/documents/presign', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function confirmDocument(key: string, expiryDate?: string): Promise<CandidateDocument> {
  return apiFetch<CandidateDocument>('/candidates/me/documents/confirm', {
    method: 'POST',
    body: JSON.stringify({ key, ...(expiryDate ? { expiryDate } : {}) }),
  });
}

// ─── OTP (phone-verify during onboarding — distinct from login OTP) ───────────

export function postOtpSend(phone: string): Promise<{ sent: boolean }> {
  return apiFetch<{ sent: boolean }>('/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
}

export function postOtpVerify(
  phone: string,
  otp: string,
): Promise<{ phoneVerified: boolean; whatsappCapable: boolean }> {
  return apiFetch<{ phoneVerified: boolean; whatsappCapable: boolean }>('/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ phone, otp }),
  });
}
