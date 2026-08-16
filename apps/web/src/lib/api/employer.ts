import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch } from '@/lib/api/client';

type Company = components['schemas']['Company'];
type EmployerDashboard = components['schemas']['EmployerDashboard'];
type CompanyType = components['schemas']['CompanyType'];
type EmployeeRange = components['schemas']['EmployeeRange'];

export interface EmployerSubscription {
  planName: string;
  planKey: 'FREE' | 'PRO' | 'ENTERPRISE';
  expiresAt: string | null;
  activeJobsLimit: number;
}

/**
 * Registration submits a COMPLETE profile — every field below except
 * `languagePref` is required by the API, so the type requires them too.
 *
 * They were optional here while the server also treated them as optional, which
 * let the form send a half-filled company into the approval queue. Making them
 * required in the TYPE means a caller that forgets one fails to compile rather
 * than failing at runtime with a 400 it cannot attribute to a field.
 */
export interface RegisterCompanyBody {
  name: string;
  type: CompanyType;
  /** Dial code, e.g. "+91". Stored separately from `phone`. */
  phoneCode: string;
  phone: string;
  country: string;
  /** City or area within `country`. */
  location: string;
  employeeRange: EmployeeRange;
  registrationNumber: string;
  industryType: string;
  /** Year of incorporation. Not in the future; see the API's founded-year rule. */
  foundedYear: number;
  website: string;
  /** Derived from the contract so it widens with the `languagePref` enum. */
  languagePref?: Company['languagePref'];
  description: string;
  registrationCertKey?: string;
}

export interface CertPresignResponse {
  uploadUrl: string;
  key: string;
  expiresInSeconds: number;
}

export function getCompany(): Promise<Company> {
  return apiFetch<Company>('/employers/me/company');
}

export function patchCompany(body: Partial<Company>): Promise<Company> {
  return apiFetch<Company>('/employers/me/company', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function registerCompany(body: RegisterCompanyBody): Promise<Company> {
  return apiFetch<Company>('/employers/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function presignCompanyCert(payload: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<CertPresignResponse> {
  return apiFetch<CertPresignResponse>('/employers/me/company/documents/presign', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function confirmCompanyCert(key: string): Promise<Company> {
  return apiFetch<Company>('/employers/me/company/documents/confirm', {
    method: 'POST',
    body: JSON.stringify({ key }),
  });
}

export function getDashboard(): Promise<EmployerDashboard> {
  return apiFetch<EmployerDashboard>('/employers/me/dashboard');
}

export function getSubscription(): Promise<EmployerSubscription> {
  return apiFetch<EmployerSubscription>('/billing/subscription');
}
