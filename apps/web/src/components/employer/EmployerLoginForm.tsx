'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { getCompany } from '@/lib/api/employer';
import { ApiRequestError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
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
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">{t('formTitle')}</h1>
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

        <Field id="emp-email" label={t('emailLabel')} required>
          <Input
            id="emp-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('emailPlaceholder')}
          />
        </Field>

        <PasswordField
          id="emp-password"
          label={t('passwordLabel')}
          value={password}
          placeholder={t('passwordPlaceholder')}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
        />

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-neutral-600 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-neutral-300 text-primary-600 focus:ring-primary-500 size-4"
            />
            {t('rememberMe')}
          </label>
          <Link
            href={`/${locale}/forgot-password`}
            className="text-sm text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
          >
            {t('forgotPassword')}
          </Link>
        </div>

        <Button
          type="submit"
          variant="secondary"
          size="md"
          loading={loading}
          className="w-full mt-1"
        >
          {t('loginButton')}
        </Button>
      </form>

      <div className="flex flex-col gap-2 text-sm text-center text-neutral-500">
        <p>
          {t('noAccount')}{' '}
          <Link
            href={`/${locale}/signup?role=employer`}
            className="font-medium text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
          >
            {t('registerLink')}
          </Link>
        </p>
        <p>
          {t('candidateLink')}{' '}
          <Link
            href={`/${locale}/login`}
            className="font-medium text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
          >
            {tAuth('loginLink')}
          </Link>
        </p>
      </div>
    </div>
  );
}
