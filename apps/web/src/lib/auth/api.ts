import type { components } from '@skillindiaconnect/shared-types';
import { apiFetch } from '@/lib/api/client';

type AuthTokenResponse = components['schemas']['AuthTokenResponse'];

export interface SignupBody {
  email: string;
  password: string;
  role: 'CANDIDATE' | 'EMPLOYER';
  acceptedTerms: boolean;
}

export interface LoginBody {
  email: string;
  password: string;
}

export function postSignup(body: SignupBody): Promise<AuthTokenResponse> {
  return apiFetch<AuthTokenResponse>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function postLogin(body: LoginBody): Promise<AuthTokenResponse> {
  return apiFetch<AuthTokenResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// skipRefreshRetry prevents the 401-retry loop from recursively calling itself
export function postRefresh(): Promise<{ accessToken: string }> {
  return apiFetch<{ accessToken: string }>('/auth/refresh', { method: 'POST' }, true);
}

export function postLogout(): Promise<void> {
  return apiFetch<void>('/auth/logout', { method: 'POST' });
}

export function postPhoneLoginStart(phone: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/auth/login/phone/start', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
}

export function postPhoneLoginVerify(phone: string, otp: string): Promise<AuthTokenResponse> {
  return apiFetch<AuthTokenResponse>('/auth/login/phone/verify', {
    method: 'POST',
    body: JSON.stringify({ phone, otp }),
  });
}

export function postForgotPassword(email: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function postResetPassword(token: string, password: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

// ─── Phone signup (candidates only) ──────────────────────────────────────────

export function postPhoneSignupStart(phone: string): Promise<{ sent: boolean }> {
  return apiFetch<{ sent: boolean }>('/auth/signup/phone/start', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
}

export function postPhoneSignupVerify(
  phone: string,
  otp: string,
  acceptedTerms: boolean,
): Promise<AuthTokenResponse> {
  return apiFetch<AuthTokenResponse>('/auth/signup/phone/verify', {
    method: 'POST',
    body: JSON.stringify({ phone, otp, acceptedTerms }),
  });
}

// ─── Email verification + first password (phone-signup onboarding) ───────────

export function postEmailVerifyStart(email: string): Promise<{ sent: boolean }> {
  return apiFetch<{ sent: boolean }>('/auth/email/verify/start', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function postEmailVerifyConfirm(
  email: string,
  otp: string,
): Promise<{ email: string; emailVerifiedAt: string }> {
  return apiFetch<{ email: string; emailVerifiedAt: string }>('/auth/email/verify/confirm', {
    method: 'POST',
    body: JSON.stringify({ email, otp }),
  });
}

export function postSetPassword(password: string): Promise<{ passwordSet: boolean }> {
  return apiFetch<{ passwordSet: boolean }>('/auth/password/set', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}
