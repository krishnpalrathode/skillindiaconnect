'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/auth-context';
import { ApiRequestError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { PasswordField } from './PasswordField';

interface LoginFormProps {
  onSuccess: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const t = useTranslations('auth');
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [generalError, setGeneralError] = useState('');
  const [emailError, setEmailError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGeneralError('');
    setEmailError('');
    setLoading(true);
    try {
      await login(email, password);
      onSuccess();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.error.code === 'INVALID_CREDENTIALS') {
          setGeneralError(t('invalidCredentials'));
        } else if (err.error.code === 'ACCOUNT_SUSPENDED') {
          setGeneralError(t('accountSuspended'));
        } else {
          setGeneralError(t('genericError'));
        }
      } else {
        setGeneralError(t('genericError'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {generalError && (
        <p role="alert" className="text-sm text-error-fg font-medium">
          {generalError}
        </p>
      )}

      <Field id="login-email" label={t('emailLabel')} error={emailError} required>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('emailPlaceholder')}
          hasError={!!emailError}
        />
      </Field>

      <PasswordField
        id="login-password"
        label={t('passwordLabel')}
        value={password}
        placeholder={t('passwordPlaceholder')}
        autoComplete="current-password"
        onChange={(e) => setPassword(e.target.value)}
      />

      <div className="flex justify-end">
        <Link
          href="/forgot-password"
          className="text-sm text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {t('forgotPassword')}
        </Link>
      </div>

      <Button type="submit" variant="secondary" size="md" loading={loading} className="w-full">
        {t('loginButton')}
      </Button>
    </form>
  );
}
