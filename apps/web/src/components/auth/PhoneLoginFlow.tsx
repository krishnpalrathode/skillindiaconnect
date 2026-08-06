'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth/auth-context';
import { postPhoneLoginStart } from '@/lib/auth/api';
import { ApiRequestError } from '@/lib/api/client';
import { maskPhone } from '@/lib/mask';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { OtpEntry } from './OtpEntry';

type Step = 'phone' | 'otp';

interface PhoneLoginFlowProps {
  onSuccess: () => void;
  /**
   * Switches the sign-in panel to the email method.
   *
   * REQUIRED, not optional, and that is the point: this is the only escape
   * hatch a user has when the WhatsApp OTP never arrives, and an optional prop
   * is one a caller can quietly drop. Making it required means the affordance
   * cannot go missing without the build failing.
   */
  onUseEmail: () => void;
}

export function PhoneLoginFlow({ onSuccess, onUseEmail }: PhoneLoginFlowProps) {
  const t = useTranslations('auth');
  const { loginWithPhone } = useAuth();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ─── Step A: phone entry ───────────────────────────────────────────────────

  async function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const fullPhone = `${countryCode}${phone.replace(/\D/g, '')}`;
    try {
      // ENUMERATION-SAFE: always 200. Advance to OTP step regardless.
      await postPhoneLoginStart(fullPhone);
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.code === 'RATE_LIMIT_EXCEEDED') {
        setError(t('otpRateLimited'));
        setLoading(false);
        return;
      }
      // Any other error: still advance (e.g. network flakiness shouldn't reveal existence)
    } finally {
      setLoading(false);
    }
    // Always advance — UI MUST NOT branch on whether an account exists
    setStep('otp');
  }

  // ─── Step B: OTP verification ──────────────────────────────────────────────

  async function handleOtpComplete(code: string) {
    setError('');
    setLoading(true);
    const fullPhone = `${countryCode}${phone.replace(/\D/g, '')}`;
    try {
      await loginWithPhone(fullPhone, code);
      onSuccess();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(t('invalidOtp'));
      } else {
        setError(t('genericError'));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError('');
    setLoading(true);
    const fullPhone = `${countryCode}${phone.replace(/\D/g, '')}`;
    try {
      await postPhoneLoginStart(fullPhone);
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.code === 'RATE_LIMIT_EXCEEDED') {
        setError(t('otpRateLimited'));
      }
    } finally {
      setLoading(false);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  /**
   * CR-WA W1.6 — the escape hatch, rendered UNCONDITIONALLY on both steps.
   *
   * WHY IT CANNOT BE CONDITIONAL. `/auth/login/phone/start` deliberately
   * swallows the send outcome and always answers with the same body: a send is
   * only ATTEMPTED for a registered number, so any failure-triggered UI would
   * tell an attacker that this number has an account. The honest
   * OTP_SEND_FAILED that `/auth/otp/send` returns is exactly what this endpoint
   * must NOT return.
   *
   * That leaves the client unable to know a send failed — so instead of
   * reacting to a failure it can't see, it offers the alternative to EVERYONE,
   * every time. An affordance present for every caller discriminates between
   * none of them, which is what keeps it enumeration-safe. It is rendered
   * outside every error/loading branch on purpose: nothing derived from a
   * response may gate it.
   *
   * Without it the outage path is a dead end — the user waits on the OTP screen
   * for a code that was never dispatched, with no way forward and nothing on
   * screen suggesting one.
   */
  const emailFallback = (
    <p className="text-center text-sm text-neutral-600">
      <button
        type="button"
        onClick={onUseEmail}
        className="font-semibold text-[#0F3D91] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
      >
        {t('useEmailInstead')}
      </button>
    </p>
  );

  if (step === 'phone') {
    return (
      <form onSubmit={handlePhoneSubmit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-neutral-600">{t('phoneLoginSubtitle')}</p>

        {error && (
          <p role="alert" className="text-sm text-error-fg font-medium">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <div className="w-24">
            <Field id="phone-cc" label={t('countryCode')}>
              <Input
                id="phone-cc"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                placeholder="+91"
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field id="phone-number" label={t('phoneLabel')} required>
              <Input
                id="phone-number"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('phonePlaceholder')}
              />
            </Field>
          </div>
        </div>

        <Button type="submit" variant="secondary" size="md" loading={loading} className="w-full">
          {t('sendOtp')}
        </Button>

        {emailFallback}
      </form>
    );
  }

  // Step B — OTP
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-neutral-600">
        {t.rich('otpSentMessage', {
          // Country code stays visible beside the masked national number; <bdi>
          // stops the number being reordered inside the RTL sentence in Arabic.
          id: () => (
            <bdi className="font-medium text-neutral-900">{`${countryCode} ${maskPhone(phone)}`}</bdi>
          ),
        })}
      </p>

      {error && (
        <p role="alert" className="text-sm text-error-fg font-medium">
          {error}
        </p>
      )}

      <OtpEntry onComplete={handleOtpComplete} disabled={loading} />

      <p className="text-xs text-neutral-600">{t('otpDidntGet')}</p>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            setStep('phone');
            setError('');
          }}
          className="text-sm text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {t('wrongNumber')}
        </button>

        <Button type="button" variant="ghost" size="sm" loading={loading} onClick={handleResend}>
          {t('resendCode')}
        </Button>
      </div>

      {/* The step where the lockout actually bites: the user is watching an
          empty OTP field for a code that may never arrive. */}
      {emailFallback}
    </div>
  );
}
