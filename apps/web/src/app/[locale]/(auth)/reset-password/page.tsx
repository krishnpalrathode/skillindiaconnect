'use client';

import React, { Suspense, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { postResetPassword } from '@/lib/auth/api';
import { ApiRequestError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';

type State = 'idle' | 'loading' | 'done' | 'invalid';

/**
 * Second half of the reset flow — the target of the emailed link.
 *
 * Unlike forgot-password, this page is NOT enumeration-sensitive: the holder of
 * a valid token is already the account owner, so failures are reported plainly.
 * An expired, consumed, or forged token all surface the SAME message, because
 * the API deliberately returns one code for all three.
 *
 * On success the user is sent to log in rather than being signed in here — the
 * reset revokes every existing session, and minting a new one straight from a
 * mailed link would hand a session to whoever opened it.
 */
export default function ResetPasswordPage() {
  // useSearchParams() opts the subtree into client-side rendering, and Next
  // fails the production build unless it sits under a Suspense boundary.
  return (
    <Suspense fallback={<div className="h-48" aria-hidden />}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setState('loading');
    try {
      await postResetPassword(token, password);
      setState('done');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.error.code === 'INVALID_RESET_TOKEN') {
          setState('invalid');
          return;
        }
        if (err.error.code === 'RATE_LIMIT_EXCEEDED') {
          setError(t('rateLimited'));
          setState('idle');
          return;
        }
        // Validation errors (weak password) carry per-field codes.
        setError(t('passwordTooWeak'));
        setState('idle');
        return;
      }
      setError(t('passwordTooWeak'));
      setState('idle');
    }
  }

  // A link with no token at all is indistinguishable to the user from an
  // expired one, and the same recovery applies — request a fresh link.
  if (state === 'invalid' || (state === 'idle' && token === '')) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="text-2xl font-bold text-neutral-900">{t('resetInvalidTitle')}</h1>
        <p className="text-sm text-neutral-600">{t('resetInvalidBody')}</p>
        <Link
          href="/forgot-password"
          className="text-sm text-primary-600 font-medium hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {t('resetRequestNew')}
        </Link>
      </div>
    );
  }

  if (state === 'done') {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="text-2xl font-bold text-neutral-900">{t('resetDoneTitle')}</h1>
        <p className="text-sm text-neutral-600">{t('resetDoneBody')}</p>
        <Link
          href="/login"
          className="text-sm text-primary-600 font-medium hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {t('goToLogin')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-neutral-900">{t('resetTitle')}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t('resetSubtitle')}</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="text-sm text-error-fg font-medium">
            {error}
          </p>
        )}

        <Field id="reset-password" label={t('newPasswordLabel')} required>
          <Input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('passwordPlaceholder')}
          />
        </Field>

        <Button
          type="submit"
          variant="secondary"
          size="md"
          loading={state === 'loading'}
          className="w-full"
        >
          {t('resetSubmit')}
        </Button>
      </form>

      <p className="text-center text-sm">
        <Link
          href="/login"
          className="text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {t('backToLogin')}
        </Link>
      </p>
    </div>
  );
}
