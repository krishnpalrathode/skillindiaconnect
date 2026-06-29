import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch } from '@/lib/api/client';

type Company = components['schemas']['Company'];
type EmployerDashboard = components['schemas']['EmployerDashboard'];

export interface EmployerSubscription {
  planName: string;
  planKey: 'FREE' | 'PRO' | 'ENTERPRISE';
  expiresAt: string | null;
  activeJobsLimit: number;
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

export function getDashboard(): Promise<EmployerDashboard> {
  return apiFetch<EmployerDashboard>('/employers/me/dashboard');
}

export function getSubscription(): Promise<EmployerSubscription> {
  return apiFetch<EmployerSubscription>('/billing/subscription');
}
