'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Mail, Lock, HardHat, Building2, Check } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { ApiRequestError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { PasswordField } from './PasswordField';

type Role = 'CANDIDATE' | 'EMPLOYER';

interface SignupFormProps {
  onSuccess: (role: Role) => void;
}

// Role-card visuals only. Descriptions are hardcoded EN this pass (translation
// files are frozen for this UI task) — same precedent as the hero copy.
const ROLE_CARD_META: Record<Role, { Icon: typeof HardHat; description: string }> = {
  CANDIDATE: { Icon: HardHat, description: 'Find jobs and build your career' },
  EMPLOYER: { Icon: Building2, description: 'Hire skilled workers' },
};

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

      {/* Hand-wired (not Field) so the icon wrapper doesn't intercept Field's
          cloneElement id — same reasoning as PasswordField. Semantics identical:
          label htmlFor, aria-describedby, role="alert" error. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-email" required>
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
            id="signup-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('emailPlaceholder')}
            hasError={!!emailError}
            aria-required
            aria-describedby={emailError ? 'signup-email-error' : undefined}
            className="ps-10 rounded-lg"
          />
        </div>
        {emailError && (
          <p id="signup-email-error" role="alert" className="text-xs text-error-fg font-medium">
            {emailError}
          </p>
        )}
      </div>

      <PasswordField
        id="signup-password"
        label={t('passwordLabel')}
        value={password}
        placeholder={t('passwordPlaceholder')}
        autoComplete="new-password"
        onChange={(e) => setPassword(e.target.value)}
        startIcon={<Lock className="size-4" />}
        showStrength
        strengthLabels={{
          weak: t('strength.weak'),
          fair: t('strength.fair'),
          good: t('strength.good'),
          strong: t('strength.strong'),
        }}
      />

      {/* Role selection cards — same radio semantics as before, card visuals only */}
      <div role="group" aria-labelledby="role-group-label" className="flex flex-col gap-1.5">
        <span id="role-group-label" className="text-sm font-medium text-neutral-700">
          {t('roleSwitcherLabel')}
        </span>
        <div className="grid grid-cols-2 gap-3">
          {(['CANDIDATE', 'EMPLOYER'] as const).map((r) => {
            const selected = role === r;
            const { Icon, description } = ROLE_CARD_META[r];
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setRole(r)}
                className={cn(
                  'relative flex flex-col items-center gap-1 rounded-xl border-2 px-3 py-4 text-center transition-colors',
                  'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
                  selected
                    ? 'border-[#0F3D91] bg-[#eef4ff]'
                    : 'border-neutral-200 bg-white hover:border-neutral-300',
                )}
              >
                {selected && (
                  <span
                    aria-hidden="true"
                    className="absolute top-2 end-2 flex size-5 items-center justify-center rounded-full bg-[#0F3D91]"
                  >
                    <Check className="size-3 text-white" strokeWidth={3} />
                  </span>
                )}
                <Icon
                  className={cn('size-7', selected ? 'text-[#0F3D91]' : 'text-neutral-400')}
                  aria-hidden="true"
                />
                <span
                  className={cn(
                    'text-sm font-semibold',
                    selected ? 'text-[#0F3D91]' : 'text-neutral-800',
                  )}
                >
                  {r === 'CANDIDATE' ? t('roleCandidate') : t('roleEmployer')}
                </span>
                <span className="text-xs leading-snug text-neutral-500">{description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Terms acceptance */}
      <label className="flex items-start gap-2.5 cursor-pointer group">
        <input
          type="checkbox"
          checked={acceptedTerms}
          onChange={(e) => setAcceptedTerms(e.target.checked)}
          className="mt-0.5 size-4 rounded accent-[#0F3D91] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        />
        <span className="text-sm text-neutral-600 leading-snug">
          {t.rich('termsText', {
            terms: (chunks) => (
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#0F3D91] hover:underline"
              >
                {chunks}
              </a>
            ),
            privacy: (chunks) => (
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#0F3D91] hover:underline"
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
        className="w-full h-12 rounded-xl bg-[#0F3D91] text-base font-semibold hover:bg-[#0c3070] active:bg-[#0a2a63]"
      >
        {t('signupButton')}
      </Button>
    </form>
  );
}
