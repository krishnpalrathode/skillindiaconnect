'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useSearchParams } from 'next/navigation';
import { AtSign, Lock, HardHat, Building2, Check } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { postPhoneSignupStart } from '@/lib/auth/api';
import { classifyIdentifier, toE164 } from '@/lib/auth/identifier';
import { ApiRequestError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CountryCodeSelect } from '@/components/common/CountryCodeSelect';
import { DEFAULT_DIAL_OPTION, type DialCodeOption } from '@/lib/dial-codes';
import { cn } from '@/lib/utils';
import { PasswordField } from './PasswordField';
import { OtpEntry } from './OtpEntry';
import { maskPhone } from '@/lib/mask';

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

/** `?role=employer` (case-insensitive) preselects the Employer card. */
function roleFromParam(raw: string | null | undefined): Role {
  return raw?.toLowerCase() === 'employer' ? 'EMPLOYER' : 'CANDIDATE';
}

/**
 * Signup with ONE field that takes either an email address or a mobile number.
 *
 * ── Why one field and not two tabs ───────────────────────────────────────────
 * Sign-in uses tabs, and that is right there: a returning user knows which
 * credential they have. A new user does not have one yet, so a tab asks them to
 * classify themselves before they have anything to classify. The field reads
 * what they typed and shows the rest of the form to match — a password box for
 * an address, a country code and an OTP for a number.
 *
 * ── Phone signup is candidates only ──────────────────────────────────────────
 * The API has no employer phone-signup route, and this is not an oversight to
 * paper over in the client: one email = one role, employers are verified
 * against a company, and their account is reached by colleagues at a work
 * address. So when Employer is selected, a phone number gets an explanation
 * rather than a disabled button with no reason attached.
 */
export function SignupForm({ onSuccess }: SignupFormProps) {
  const t = useTranslations('auth');
  const { signup, signupWithPhone } = useAuth();
  const searchParams = useSearchParams();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  // Landing/employer-login deep-links arrive as /signup?role=employer. Read it
  // once as the initial value so the user can still switch freely afterwards —
  // syncing it on every render would fight their clicks.
  const [role, setRole] = useState<Role>(() => roleFromParam(searchParams?.get('role')));
  const [identifier, setIdentifier] = useState('');
  const [country, setCountry] = useState<DialCodeOption>(DEFAULT_DIAL_OPTION);
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [identifierError, setIdentifierError] = useState('');
  const [generalError, setGeneralError] = useState('');

  // Set once the code is on its way — this swaps the whole form for the OTP
  // panel, so it doubles as "which step are we on".
  const [otpPhone, setOtpPhone] = useState<string | null>(null);
  const [otpKey, setOtpKey] = useState(0);

  const kind = classifyIdentifier(identifier);
  const phoneDigits = identifier.replace(/\D/g, '');
  const phoneAllowed = role === 'CANDIDATE';
  const showPassword = kind === 'email';
  const showPhoneExtras = kind === 'phone' && phoneAllowed;
  const employerTypedPhone = kind === 'phone' && !phoneAllowed;

  // The submit button's job changes with the field's contents, so it is derived
  // rather than duplicated in two branches of the JSX.
  const submitLabel = showPhoneExtras ? t('sendOtp') : t('signupButton');
  const canSubmit =
    acceptedTerms && !employerTypedPhone && (showPhoneExtras ? phoneDigits.length >= 10 : true);

  function resetErrors() {
    setIdentifierError('');
    setGeneralError('');
  }

  // ─── Phone branch ──────────────────────────────────────────────────────────

  async function sendPhoneCode(e164: string) {
    await postPhoneSignupStart(e164);
    setOtpPhone(e164);
    setOtpKey((k) => k + 1);
  }

  /**
   * Every failure keeps the user on the form with the button still there, and
   * each message names a DIFFERENT next move: a taken number needs a different
   * number, an unreachable number needs email, an outage needs a retry. The one
   * thing none of them does is advance to the OTP screen — waiting for a code
   * that was never dispatched is the failure mode this whole error branch
   * exists to prevent.
   */
  function reportSendFailure(err: unknown) {
    const apiErr = err instanceof ApiRequestError ? err.error : null;
    const code = apiErr?.code ?? null;
    if (code === 'PHONE_ALREADY_IN_USE') setIdentifierError(t('phoneTaken'));
    else if (code === 'PHONE_NOT_ON_WHATSAPP') setIdentifierError(t('otpNotOnWhatsapp'));
    else if (code === 'OTP_SEND_FAILED') setGeneralError(t('otpSendFailed'));
    // Branch on the STATUS: a 429 arrives here under three different codes
    // depending on which layer rejected it (throttler vs OTP budgets).
    else if (apiErr?.status === 429) setGeneralError(t('otpRateLimited'));
    else setGeneralError(t('genericError'));
  }

  async function handleOtpComplete(code: string) {
    if (!otpPhone) return;
    resetErrors();
    setLoading(true);
    try {
      await signupWithPhone(otpPhone, code, acceptedTerms);
      onSuccess('CANDIDATE');
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.code === 'PHONE_ALREADY_IN_USE') {
        // Claimed while this code was alive — send them back to pick another.
        setIdentifierError(t('phoneTaken'));
        setOtpPhone(null);
      } else {
        setGeneralError(t('invalidOtp'));
        setOtpKey((k) => k + 1);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!otpPhone) return;
    resetErrors();
    setLoading(true);
    try {
      await sendPhoneCode(otpPhone);
    } catch (err) {
      reportSendFailure(err);
    } finally {
      setLoading(false);
    }
  }

  // ─── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    resetErrors();

    if (!acceptedTerms) {
      setGeneralError(t('mustAcceptTerms'));
      return;
    }

    setLoading(true);
    try {
      if (showPhoneExtras) {
        await sendPhoneCode(toE164(identifier, country.dialCode));
        return;
      }

      await signup({ email: identifier.trim(), password, role, acceptedTerms });
      onSuccess(role);
    } catch (err) {
      if (showPhoneExtras) {
        reportSendFailure(err);
      } else if (err instanceof ApiRequestError) {
        if (err.error.code === 'EMAIL_TAKEN') {
          setIdentifierError(t('emailTaken'));
        } else if (err.error.code === 'VALIDATION_ERROR') {
          const firstField = err.error.meta?.errors?.[0];
          if (firstField?.field === 'email') {
            setIdentifierError(t('invalidEmail'));
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

  // ─── OTP step ──────────────────────────────────────────────────────────────

  if (otpPhone) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-600">
          {t.rich('otpSentMessage', {
            // <bdi> stops the number being reordered inside an RTL sentence.
            id: () => <bdi className="font-medium text-neutral-900">{maskPhone(otpPhone)}</bdi>,
          })}
        </p>

        {generalError && (
          <p role="alert" className="text-sm font-medium text-error-fg">
            {generalError}
          </p>
        )}

        <OtpEntry key={otpKey} onComplete={handleOtpComplete} disabled={loading} />

        <p className="text-xs text-neutral-600">{t('otpDidntGet')}</p>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setOtpPhone(null);
              resetErrors();
            }}
            className="rounded text-sm text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            {t('wrongNumber')}
          </button>

          <Button type="button" variant="ghost" size="sm" loading={loading} onClick={handleResend}>
            {t('resendCode')}
          </Button>
        </div>
      </div>
    );
  }

  // ─── Form ──────────────────────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {generalError && (
        <p role="alert" className="text-sm font-medium text-error-fg">
          {generalError}
        </p>
      )}

      {/* Hand-wired (not Field) so the icon wrapper doesn't intercept Field's
          cloneElement id — same reasoning as PasswordField. Semantics identical:
          label htmlFor, aria-describedby, role="alert" error. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-identifier" required>
          {t('identifierLabel')}
        </Label>

        {/* The country code appears only once the field looks like a phone
            number, so an address is never asked to pick a country. */}
        <div
          className={cn(
            'flex items-stretch overflow-hidden rounded-lg',
            showPhoneExtras &&
              'h-12 border border-input bg-white focus-within:border-[#0F3D91] focus-within:ring-[3px] focus-within:ring-ring/70',
          )}
        >
          {showPhoneExtras && (
            <>
              <label htmlFor="signup-phone-code" className="sr-only">
                {t('countryCode')}
              </label>
              <div className="w-[7.5rem] shrink-0 border-e border-neutral-200 bg-neutral-50/70">
                <CountryCodeSelect
                  id="signup-phone-code"
                  compact
                  value={country.iso}
                  disabled={loading}
                  searchLabel={t('phoneCodeSearch')}
                  emptyLabel={t('phoneCodeEmpty')}
                  onChange={setCountry}
                  className="[&>button]:h-12 [&>button]:rounded-none [&>button]:border-0 [&>button]:bg-transparent [&>button]:shadow-none"
                />
              </div>
            </>
          )}

          <div className="relative flex-1">
            {!showPhoneExtras && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-neutral-600"
              >
                <AtSign className="size-4" />
              </span>
            )}
            <Input
              id="signup-identifier"
              // NOT type="email": the browser would mark a phone number invalid
              // and suppress its own autofill for one.
              type="text"
              inputMode={kind === 'phone' ? 'tel' : 'email'}
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={t('identifierPlaceholder')}
              hasError={!!identifierError}
              aria-required
              aria-describedby={
                identifierError
                  ? 'signup-identifier-error'
                  : showPhoneExtras
                    ? 'signup-identifier-hint'
                    : undefined
              }
              dir={kind === 'phone' ? 'ltr' : undefined}
              className={cn(
                showPhoneExtras
                  ? 'h-full rounded-none border-0 bg-transparent focus-visible:ring-0'
                  : 'rounded-lg ps-10',
              )}
            />
          </div>
        </div>

        {identifierError && (
          <p
            id="signup-identifier-error"
            role="alert"
            className="text-xs font-medium text-error-fg"
          >
            {identifierError}
          </p>
        )}

        {!identifierError && showPhoneExtras && (
          <p id="signup-identifier-hint" className="text-xs text-neutral-600">
            {t('identifierHintPhone')}
          </p>
        )}

        {/* An employer who types a number gets the reason, not a dead button. */}
        {employerTypedPhone && (
          <p role="alert" className="text-xs font-medium text-error-fg">
            {t('employerNeedsEmail')}
          </p>
        )}
      </div>

      {showPassword && (
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
      )}

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
                onClick={() => {
                  setRole(r);
                  resetErrors();
                }}
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
                    className="absolute end-2 top-2 flex size-5 items-center justify-center rounded-full bg-[#0F3D91]"
                  >
                    <Check className="size-3 text-white" strokeWidth={3} />
                  </span>
                )}
                <Icon
                  className={cn('size-7', selected ? 'text-[#0F3D91]' : 'text-neutral-600')}
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
                <span className="text-xs leading-snug text-neutral-600">{description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Terms acceptance */}
      <label className="group flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={acceptedTerms}
          onChange={(e) => setAcceptedTerms(e.target.checked)}
          className="mt-0.5 size-4 rounded accent-[#0F3D91] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        />
        <span className="text-sm leading-snug text-neutral-600">
          {t.rich('termsText', {
            terms: (chunks) => (
              <a
                href={`/${locale}/terms`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#0F3D91] hover:underline"
              >
                {chunks}
              </a>
            ),
            privacy: (chunks) => (
              <a
                href={`/${locale}/privacy`}
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
        disabled={!canSubmit}
        className="h-12 w-full rounded-xl bg-[#0F3D91] text-base font-semibold hover:bg-[#0c3070] active:bg-[#0a2a63]"
      >
        {submitLabel}
      </Button>
    </form>
  );
}
