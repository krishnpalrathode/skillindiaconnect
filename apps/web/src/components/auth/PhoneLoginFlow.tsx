'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth/auth-context';
import { postPhoneLoginStart } from '@/lib/auth/api';
import { ApiRequestError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { OtpEntry } from './OtpEntry';

type Step = 'phone' | 'otp';

interface PhoneLoginFlowProps {
  onSuccess: () => void;
}

export function PhoneLoginFlow({ onSuccess }: PhoneLoginFlowProps) {
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
      </form>
    );
  }

  // Step B — OTP
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-neutral-600">{t('otpSentMessage')}</p>

      {error && (
        <p role="alert" className="text-sm text-error-fg font-medium">
          {error}
        </p>
      )}

      <OtpEntry onComplete={handleOtpComplete} disabled={loading} />

      <p className="text-xs text-neutral-500">{t('otpDidntGet')}</p>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => { setStep('phone'); setError(''); }}
          className="text-sm text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {t('wrongNumber')}
        </button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={loading}
          onClick={handleResend}
        >
          {t('resendCode')}
        </Button>
      </div>
    </div>
  );
}
