'use client';

import React, { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { OtpEntry } from '@/components/auth/OtpEntry';
import { postOtpSend, postOtpVerify } from '@/lib/api/candidate';
import { ApiRequestError } from '@/lib/api/client';
import { Ltr } from '@/components/common/Ltr';
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  flagEmoji,
  splitE164,
  type CountryOption,
} from '@/lib/countries';

const RESEND_COOLDOWN_SEC = 60;

/**
 * National digits + the chosen dial code → E.164.
 *
 * The country now comes from an explicit select rather than being assumed to be
 * India, so this no longer guesses from the digit count. A number the user
 * pasted WITH its country code (a leading `+`, or the dial code typed twice) is
 * detected and not double-prefixed.
 */
function toE164(nationalDigits: string, dialCode: string): string {
  const digits = nationalDigits.replace(/\D/g, '');
  const bare = dialCode.replace('+', '');
  return digits.startsWith(bare) ? `+${digits}` : `${dialCode}${digits}`;
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
  const tToast = useTranslations('toast');
  const { showToast } = useToast();

  const [stage, setStage] = useState<Stage>(alreadyVerified ? 'verified' : 'input');

  /*
    An already-saved number arrives in E.164 (+919452100006). Split it back into
    its country and national parts so the select shows the right flag and the
    input shows a number the candidate recognises — not their own number with an
    unfamiliar prefix glued to the front.
  */
  const parsed = initialPhone ? splitE164(initialPhone) : null;
  const [country, setCountry] = useState<CountryOption>(parsed?.country ?? DEFAULT_COUNTRY);
  const [phone, setPhone] = useState(parsed?.national ?? initialPhone.replace(/\D/g, ''));
  const phoneDigits = phone.replace(/\D/g, '');
  const e164 = toE164(phone, country.dialCode);
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
    if (phone.replace(/\D/g, '').length < 10) return;
    setError(null);
    setLoading(true);
    try {
      await postOtpSend(e164);
      setStage('otp');
      setOtpKey((k) => k + 1);
      startCooldown();
      /*
        Fires only AFTER the 200 — every failure path below throws before
        reaching here, so this can never claim a code was dispatched when it
        was not (the W1.5/W1.6 lesson two layers down).

        It complements rather than repeats the inline copy: the toast confirms
        the SEND happened, the text under the field tells you what to do next.
        It also covers Resend, where the stage does not change and the inline
        text was already on screen — so without this, a resend gave no signal
        at all that anything had happened.
      */
      showToast({ message: tToast('otpSent') });
    } catch (err) {
      /**
       * CR-WA W1.6 — the UI half of W1.5.
       *
       * The fallback branch here used to render t('otpSent') — literally "Enter
       * the 6-digit code sent to your number" — AS THE ERROR. So a failed send
       * told the user their code was on its way, then sat there while they
       * waited for something that was never dispatched. That is the same false
       * success W1.5 removed from the API, surviving one layer up: an honest
       * 503 is worth nothing while the client still renders it as "sent".
       *
       * The two failures are kept DISTINCT because the user's next move
       * differs. NOT_ON_WHATSAPP is about their number and needs a different
       * one; OTP_SEND_FAILED is about our provider and retrying is the right
       * move. Collapsing them would send people hunting for a second SIM during
       * an outage.
       *
       * The stage deliberately stays 'input' on every failure, so the send
       * button remains and retrying costs one tap.
       */
      const apiErr = err instanceof ApiRequestError ? err.error : null;
      const code = apiErr?.code ?? null;
      if (code === 'PHONE_ALREADY_IN_USE') {
        setError(t('phoneAlreadyRegistered'));
      } else if (code === 'PHONE_NOT_ON_WHATSAPP') {
        setError(t('otpNotOnWhatsapp'));
      } else if (code === 'OTP_SEND_FAILED') {
        setError(t('otpSendFailed'));
      } else if (apiErr?.status === 429) {
        /**
         * BRANCH ON THE STATUS, NOT THE CODE. A 429 reaches here under THREE
         * different codes depending on which layer rejected it:
         *   OTP_RATE_LIMITED   — OtpService's per-phone (5/h) and per-IP budgets
         *   RATE_LIMITED       — ThrottlerGuard (5/min), via HttpProblemFilter's
         *                        DEFAULT_CODES
         *   RATE_LIMIT_EXCEEDED — password-reset only, but cheap to cover
         * Matching on one code silently misses the others, which is exactly how
         * this screen ended up telling a rate-limited user to "try again" —
         * the one action guaranteed to keep failing and to extend the window.
         */
        setError(t('otpRateLimited'));
      } else {
        setError(t('otpSendError'));
      }
    } finally {
      setLoading(false);
    }
  }, [e164, phone, startCooldown, t, showToast, tToast]);

  const handleOtpComplete = useCallback(
    async (code: string) => {
      setError(null);
      setLoading(true);
      try {
        await postOtpVerify(e164, code);
        setStage('verified');
        onVerified(e164);
      } catch (err) {
        // A number claimed by another candidate is rejected here too (safety net
        // for a race with the send-time guard) — send them back to enter a new one.
        if (err instanceof ApiRequestError && err.error.code === 'PHONE_ALREADY_IN_USE') {
          setError(t('phoneAlreadyRegistered'));
          setStage('input');
        } else {
          setError(t('otpInvalid'));
          setOtpKey((k) => k + 1);
        }
      } finally {
        setLoading(false);
      }
    },
    [e164, onVerified, t],
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
            <Ltr>{e164}</Ltr>
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
        <div className="flex flex-wrap gap-2">
          {/* Deliberately NOT <Field>: it cloneElement's its `id` onto its single
              child, which here is the wrapper div — pointing the <label> at a
              non-labellable element and silently breaking the association for
              screen readers. The label is bound straight to the input instead. */}
          <div className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
            <Label htmlFor="onboarding-phone" required>
              {t('phoneLabel')}
            </Label>
            {/* Country code + number as ONE bordered control, so it reads as a
                single phone field rather than two unrelated inputs. */}
            <div className="flex h-12 items-stretch overflow-hidden rounded-xl border border-input bg-white focus-within:border-[#0F3D91] focus-within:ring-[3px] focus-within:ring-ring/70">
              <label htmlFor="onboarding-phone-code" className="sr-only">
                {t('phoneCodeLabel')}
              </label>
              <select
                id="onboarding-phone-code"
                value={country.iso}
                onChange={(e) =>
                  setCountry(COUNTRIES.find((c) => c.iso === e.target.value) ?? DEFAULT_COUNTRY)
                }
                disabled={loading}
                // `dir=ltr` — a dial code is always read left-to-right, even in Arabic.
                dir="ltr"
                className="h-full shrink-0 border-e border-neutral-200 bg-neutral-50/70 ps-3 pe-2 text-sm font-medium text-neutral-800 outline-none focus-visible:outline-none"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.iso} value={c.iso}>
                    {flagEmoji(c.iso)} {c.dialCode}
                  </option>
                ))}
              </select>
              <Input
                id="onboarding-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={15}
                placeholder={t('phonePlaceholder')}
                value={phone}
                // Digits only — reject letters/spaces/symbols as they're typed or pasted.
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                disabled={loading}
                dir="ltr"
                // The wrapper owns the border and focus ring now.
                className="h-full flex-1 rounded-none border-0 bg-transparent focus-visible:ring-0"
              />
            </div>
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              variant="secondary"
              size="md"
              loading={loading}
              disabled={phoneDigits.length < 10}
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
