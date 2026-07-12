'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { Briefcase, Mail, Lock, ArrowRight } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { getCompany } from '@/lib/api/employer';
import { ApiRequestError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordField } from '@/components/auth/PasswordField';

export function EmployerLoginForm() {
  const t = useTranslations('employer.login');
  const tAuth = useTranslations('auth');
  const { login } = useAuth();
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      // Decide-then-route: check if employer already has a company profile.
      // getCompany() succeeds → dashboard (any status — shell handles banner).
      // getCompany() throws 404 → no company yet → onboarding.
      try {
        await getCompany();
        router.push(`/${locale}/employer/dashboard`);
      } catch (companyErr) {
        if (companyErr instanceof ApiRequestError && companyErr.error.status === 404) {
          router.push(`/${locale}/employer/onboarding`);
        } else {
          // Non-404 error fetching company: still go to dashboard; shell handles it
          router.push(`/${locale}/employer/dashboard`);
        }
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.error.code === 'INVALID_CREDENTIALS') {
          setError(t('invalidCredentials'));
        } else if (err.error.code === 'ACCOUNT_SUSPENDED') {
          // Suspended employers can log in; the shell's banner communicates state.
          // Treat as a successful login flow — attempt company check then redirect.
          try {
            await getCompany();
            router.push(`/${locale}/employer/dashboard`);
          } catch {
            router.push(`/${locale}/employer/dashboard`);
          }
        } else {
          setError(t('genericError'));
        }
      } else {
        setError(t('genericError'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Heading with the employer briefcase mark per the approved design */}
      <div className="flex items-center gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[#eef4ff] text-[#0F3D91]">
          <Briefcase className="size-6" aria-hidden="true" />
        </span>
        <h1 className="text-xl font-bold leading-snug text-neutral-900 sm:text-2xl">
          {t('formTitle')}
        </h1>
      </div>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {error && (
          <p
            role="alert"
            className="text-sm text-error-fg font-medium rounded-lg bg-error-bg px-3 py-2"
          >
            {error}
          </p>
        )}

        {/* Hand-wired (not Field) so the icon wrapper doesn't intercept Field's
            cloneElement id — same reasoning as the candidate auth forms.
            Semantics identical: label htmlFor → input id. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="emp-email" required>
            {t('emailLabel')}
          </Label>
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-neutral-400"
            >
              <Mail className="size-4" />
            </span>
            <Input
              id="emp-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              aria-required
              className="ps-10 rounded-lg"
            />
          </div>
        </div>

        <PasswordField
          id="emp-password"
          label={t('passwordLabel')}
          value={password}
          placeholder={t('passwordPlaceholder')}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
          startIcon={<Lock className="size-4" />}
        />

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-neutral-600 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-neutral-300 accent-[#0F3D91] focus:ring-primary-500 size-4"
            />
            {t('rememberMe')}
          </label>
          <Link
            href={`/${locale}/forgot-password`}
            className="text-sm font-medium text-[#0F3D91] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
          >
            {t('forgotPassword')}
          </Link>
        </div>

        <Button
          type="submit"
          variant="secondary"
          size="md"
          loading={loading}
          className="relative w-full h-12 rounded-xl bg-[#0F3D91] text-base font-semibold hover:bg-[#0c3070] active:bg-[#0a2a63] mt-1"
        >
          {t('loginButton')}
          <ArrowRight
            className="absolute end-4 top-1/2 size-5 -translate-y-1/2 rtl:rotate-180"
            aria-hidden="true"
          />
        </Button>
      </form>

      {/* Divider */}
      <div className="relative flex items-center gap-3">
        <div className="flex-1 border-t border-neutral-200" />
        <span className="text-xs text-neutral-400 lowercase">{tAuth('orDivider')}</span>
        <div className="flex-1 border-t border-neutral-200" />
      </div>

      <div className="flex flex-col gap-2 text-sm text-center text-neutral-500">
        <p>
          {t('noAccount')}{' '}
          <Link
            href={`/${locale}/signup?role=employer`}
            className="font-semibold text-[#0F3D91] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
          >
            {t('registerLink')}
          </Link>
        </p>
        <p>
          {t('candidateLink')}{' '}
          <Link
            href={`/${locale}/login`}
            className="font-semibold text-[#0F3D91] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
          >
            {tAuth('loginLink')}
          </Link>
        </p>
      </div>
    </div>
  );
}
