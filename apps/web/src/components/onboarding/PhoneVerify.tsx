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
import { Ltr } from '@/components/common/Ltr';

const RESEND_COOLDOWN_SEC = 60;

// Normalizes an Indian 10-digit number to E.164. Already-prefixed numbers pass through.
function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (!raw.startsWith('+')) return `+${digits}`;
  return raw.trim();
}

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
      await postOtpSend(toE164(phone));
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
        await postOtpVerify(toE164(phone), code);
        setStage('verified');
        onVerified(toE164(phone));
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
      <div className="flex items-center gap-3 rounded-2xl border border-success-fg/20 bg-success-bg p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
          <CheckCircle2 className="size-5 text-success-fg" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold text-success-fg">{t('phoneVerified')}</p>
          <p className="text-xs text-neutral-600">
            <Ltr>{phone}</Ltr>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setStage('input')}
          className="ms-auto rounded text-xs font-medium text-neutral-600 underline hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('phoneVerify')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-[22px] border border-neutral-200/70 bg-gradient-to-br from-neutral-50 to-[#E8F0FE]/40 p-5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-[#0F3D91]">
          <Phone className="size-4" aria-hidden="true" />
        </span>
        <p className="text-sm font-bold text-neutral-800">{t('phoneVerifyTitle')}</p>
      </div>
      <p className="text-xs text-neutral-600">{t('phoneVerifySubtitle')}</p>

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
              className="h-12 rounded-xl bg-white"
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
              className="h-12 rounded-xl"
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
