'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { postForgotPassword } from '@/lib/auth/api';
import { ApiRequestError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';

type State = 'idle' | 'loading' | 'sent';

// Enumeration-safe: the API always returns 200 regardless of whether the
// email is registered. We never tell the user if the address is in our system.
export default function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setState('loading');
    try {
      await postForgotPassword(email);
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.code === 'RATE_LIMIT_EXCEEDED') {
        setError(t('rateLimited'));
        setState('idle');
        return;
      }
      // Swallow other errors — enumeration-safe; always advance to "sent" state
    }
    setState('sent');
  }

  if (state === 'sent') {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="text-2xl font-bold text-neutral-900">{t('forgotSentTitle')}</h1>
        <p className="text-sm text-neutral-600">{t('forgotSentBody')}</p>
        <Link
          href="/login"
          className="text-sm text-primary-600 font-medium hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {t('backToLogin')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-neutral-900">{t('forgotTitle')}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t('forgotSubtitle')}</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="text-sm text-error-fg font-medium">
            {error}
          </p>
        )}

        <Field id="forgot-email" label={t('emailLabel')} required>
          <Input
            id="forgot-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('emailPlaceholder')}
          />
        </Field>

        <Button
          type="submit"
          variant="secondary"
          size="md"
          loading={state === 'loading'}
          className="w-full"
        >
          {t('sendResetEmail')}
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
