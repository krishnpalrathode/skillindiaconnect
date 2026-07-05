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

export interface RegisterCompanyBody {
  name: string;
  type: CompanyType;
  phone: string;
  location: string;
  employeeRange: EmployeeRange;
  registrationNumber?: string;
  industryType?: string;
  website?: string;
  languagePref?: 'en' | 'hi' | 'ar';
  description?: string;
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
