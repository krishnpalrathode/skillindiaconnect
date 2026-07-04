import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch } from '@/lib/api/client';

type EmployerProfile = components['schemas']['EmployerProfile'];
type HiringPreferences = components['schemas']['HiringPreferences'];
type ContactPerson = components['schemas']['ContactPerson'];

export interface LogoPresignResponse {
  uploadUrl: string;
  key: string;
  expiresInSeconds: number;
}

export interface CreateContactBody {
  name: string;
  role: string;
  phone?: string;
  email?: string;
  isPrimary: boolean;
}

export type UpdateContactBody = Partial<CreateContactBody>;

export function getEmployerProfile(): Promise<EmployerProfile> {
  return apiFetch<EmployerProfile>('/employers/me/profile');
}

export function patchHiringPreferences(body: HiringPreferences): Promise<HiringPreferences> {
  return apiFetch<HiringPreferences>('/employers/me/profile/hiring-preferences', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function createContact(body: CreateContactBody): Promise<ContactPerson> {
  return apiFetch<ContactPerson>('/employers/me/profile/contacts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateContact(id: string, body: UpdateContactBody): Promise<ContactPerson> {
  return apiFetch<ContactPerson>(`/employers/me/profile/contacts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteContact(id: string): Promise<void> {
  return apiFetch<void>(`/employers/me/profile/contacts/${id}`, {
    method: 'DELETE',
  });
}

export function presignLogo(payload: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<LogoPresignResponse> {
  return apiFetch<LogoPresignResponse>('/employers/me/profile/logo/presign', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function confirmLogo(key: string): Promise<EmployerProfile> {
  return apiFetch<EmployerProfile>('/employers/me/profile/logo/confirm', {
    method: 'POST',
    body: JSON.stringify({ key }),
  });
}
