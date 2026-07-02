'use client';

import React, { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { OtpEntry } from '@/components/auth/OtpEntry';
import { postOtpSend, postOtpVerify } from '@/lib/api/candidate';
import { ApiRequestError } from '@/lib/api/client';

const RESEND_COOLDOWN_SEC = 60;

interface PhoneVerifyProps {
  initialPhone?: string;
  alreadyVerified?: boolean;
  onVerified: (phone: string) => void;
}

type Stage = 'input' | 'otp' | 'verified';

/**
 * Phone verification widget for candidate onboarding.
 * Distinct from login-OTP: uses POST /auth/otp/send + /auth/otp/verify (PHONE_VERIFY purpose).
 * Soft-block: non-required; shows "Already verified" badge when phoneVerifiedAt is set.
 */
export function PhoneVerify({
  initialPhone = '',
  alreadyVerified = false,
  onVerified,
}: PhoneVerifyProps) {
  const t = useTranslations('onboarding.personalInfo');

  const [stage, setStage] = useState<Stage>(alreadyVerified ? 'verified' : 'input');
  const [phone, setPhone] = useState(initialPhone);
  const [otpKey, setOtpKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const startCooldown = useCallback(() => {
    setCooldown(RESEND_COOLDOWN_SEC);
    const timer = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) {
          clearInterval(timer);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, []);

  const handleSend = useCallback(async () => {
    if (!phone.trim()) return;
    setError(null);
    setLoading(true);
    try {
      await postOtpSend(phone.trim());
      setStage('otp');
      setOtpKey((k) => k + 1);
      startCooldown();
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.code === 'PHONE_NOT_ON_WHATSAPP') {
        setError(t('otpNotOnWhatsapp'));
      } else {
        setError(t('otpSent')); // fallback generic
      }
    } finally {
      setLoading(false);
    }
  }, [phone, startCooldown, t]);

  const handleOtpComplete = useCallback(
    async (code: string) => {
      setError(null);
      setLoading(true);
      try {
        await postOtpVerify(phone.trim(), code);
        setStage('verified');
        onVerified(phone.trim());
      } catch (err) {
        if (err instanceof ApiRequestError && err.error.code === 'INVALID_OTP') {
          setError(t('otpInvalid'));
        } else {
          setError(t('otpInvalid'));
        }
        setOtpKey((k) => k + 1);
      } finally {
        setLoading(false);
      }
    },
    [phone, onVerified, t],
  );

  if (stage === 'verified') {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-success-bg border border-success-fg/20">
        <CheckCircle2 className="size-5 text-success-fg shrink-0" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-success-fg">{t('phoneVerified')}</p>
          <p className="text-xs text-neutral-600">{phone}</p>
        </div>
        <button
          type="button"
          onClick={() => setStage('input')}
          className="ms-auto text-xs text-neutral-500 underline hover:text-neutral-700"
        >
          {t('phoneVerify')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-neutral-50">
      <div className="flex items-center gap-2">
        <Phone className="size-4 text-primary-600 shrink-0" aria-hidden="true" />
        <p className="text-sm font-semibold text-neutral-800">{t('phoneVerifyTitle')}</p>
      </div>
      <p className="text-xs text-neutral-500">{t('phoneVerifySubtitle')}</p>

      {stage === 'input' && (
        <div className="flex gap-2">
          <Field id="onboarding-phone" label={t('phoneLabel')} className="flex-1">
            <Input
              type="tel"
              placeholder={t('phonePlaceholder')}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              disabled={loading}
            />
          </Field>
          <div className="flex items-end">
            <Button
              type="button"
              variant="secondary"
              size="md"
              loading={loading}
              disabled={!phone.trim()}
              onClick={handleSend}
            >
              {t('phoneVerify')}
            </Button>
          </div>
        </div>
      )}

      {stage === 'otp' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-neutral-600">{t('otpSent')}</p>
          <OtpEntry key={otpKey} onComplete={handleOtpComplete} disabled={loading} />
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="link"
              size="sm"
              disabled={cooldown > 0 || loading}
              onClick={handleSend}
            >
              {cooldown > 0 ? t('resendIn', { seconds: cooldown }) : t('resendOtp')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setStage('input');
                setError(null);
              }}
            >
              {t('phoneVerify')}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-error-fg font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
