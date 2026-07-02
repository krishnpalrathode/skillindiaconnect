'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth/auth-context';
import { ApiRequestError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { PasswordField } from './PasswordField';

type Role = 'CANDIDATE' | 'EMPLOYER';

interface SignupFormProps {
  onSuccess: (role: Role) => void;
}

export function SignupForm({ onSuccess }: SignupFormProps) {
  const t = useTranslations('auth');
  const { signup } = useAuth();

  const [role, setRole] = useState<Role>('CANDIDATE');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [generalError, setGeneralError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEmailError('');
    setGeneralError('');

    if (!acceptedTerms) {
      setGeneralError(t('mustAcceptTerms'));
      return;
    }

    setLoading(true);
    try {
      await signup({ email, password, role, acceptedTerms });
      onSuccess(role);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.error.code === 'EMAIL_TAKEN') {
          setEmailError(t('emailTaken'));
        } else if (err.error.code === 'VALIDATION_ERROR') {
          const firstField = err.error.meta?.errors?.[0];
          if (firstField?.field === 'email') {
            setEmailError(t('invalidEmail'));
          } else if (firstField?.field === 'password') {
            setGeneralError(t('passwordTooWeak'));
          } else {
            setGeneralError(t('genericError'));
          }
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

      {/* Role toggle — default CANDIDATE */}
      <div role="group" aria-labelledby="role-group-label" className="flex flex-col gap-1.5">
        <span id="role-group-label" className="text-sm font-medium text-neutral-700">
          {t('roleSwitcherLabel')}
        </span>
        <div className="flex rounded-md border border-border overflow-hidden">
          {(['CANDIDATE', 'EMPLOYER'] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              onClick={() => setRole(r)}
              className={[
                'flex-1 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
                role === r
                  ? 'bg-primary-600 text-white'
                  : 'bg-background text-neutral-600 hover:bg-neutral-50',
              ].join(' ')}
            >
              {r === 'CANDIDATE' ? t('roleCandidate') : t('roleEmployer')}
            </button>
          ))}
        </div>
      </div>

      <Field id="signup-email" label={t('emailLabel')} error={emailError} required>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('emailPlaceholder')}
          hasError={!!emailError}
        />
      </Field>

      <PasswordField
        id="signup-password"
        label={t('passwordLabel')}
        value={password}
        placeholder={t('passwordPlaceholder')}
        autoComplete="new-password"
        onChange={(e) => setPassword(e.target.value)}
        showStrength
        strengthLabels={{
          weak: t('strength.weak'),
          fair: t('strength.fair'),
          good: t('strength.good'),
          strong: t('strength.strong'),
        }}
      />

      {/* Terms acceptance */}
      <label className="flex items-start gap-2.5 cursor-pointer group">
        <input
          type="checkbox"
          checked={acceptedTerms}
          onChange={(e) => setAcceptedTerms(e.target.checked)}
          className="mt-0.5 size-4 rounded accent-primary-600 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        />
        <span className="text-sm text-neutral-600 leading-snug">
          {t.rich('termsText', {
            terms: (chunks) => (
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 hover:underline"
              >
                {chunks}
              </a>
            ),
            privacy: (chunks) => (
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 hover:underline"
              >
                {chunks}
              </a>
            ),
          })}
        </span>
      </label>

      <Button
        type="submit"
        variant="secondary"
        size="md"
        loading={loading}
        disabled={!acceptedTerms}
        className="w-full"
      >
        {t('signupButton')}
      </Button>
    </form>
  );
}
