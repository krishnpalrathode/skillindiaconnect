'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Mail, Lock } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { ApiRequestError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

      {/* Hand-wired (not Field) so the icon wrapper doesn't intercept Field's
          cloneElement id — same reasoning as SignupForm/PasswordField.
          Semantics identical: label htmlFor, aria-describedby, role="alert". */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-email" required>
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
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('emailPlaceholder')}
            hasError={!!emailError}
            aria-required
            aria-describedby={emailError ? 'login-email-error' : undefined}
            className="ps-10 rounded-lg"
          />
        </div>
        {emailError && (
          <p id="login-email-error" role="alert" className="text-xs text-error-fg font-medium">
            {emailError}
          </p>
        )}
      </div>

      <PasswordField
        id="login-password"
        label={t('passwordLabel')}
        value={password}
        placeholder={t('passwordPlaceholder')}
        autoComplete="current-password"
        onChange={(e) => setPassword(e.target.value)}
        startIcon={<Lock className="size-4" />}
      />

      <div className="flex justify-end">
        <Link
          href="/forgot-password"
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
        className="w-full h-12 rounded-xl bg-[#0F3D91] text-base font-semibold hover:bg-[#0c3070] active:bg-[#0a2a63]"
      >
        {t('loginButton')}
      </Button>
    </form>
  );
}
