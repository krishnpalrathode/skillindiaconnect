'use client';

import React, { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { OtpEntry } from '@/components/auth/OtpEntry';
import { postEmailVerifyStart, postEmailVerifyConfirm } from '@/lib/auth/api';
import { ApiRequestError } from '@/lib/api/client';

const RESEND_COOLDOWN_SEC = 60;

interface EmailVerifyProps {
  initialEmail?: string;
  alreadyVerified?: boolean;
  onVerified: (email: string) => void;
}

type Stage = 'input' | 'otp' | 'verified';

/**
 * Email verification for candidates who signed up with a phone number.
 *
 * It occupies the same slot in onboarding that PhoneVerify occupies for an
 * email signup, and is deliberately the same shape — enter, receive a code,
 * confirm — because it is the same task with the credentials swapped. An email
 * signup never sees this; a phone signup never sees PhoneVerify.
 *
 * Why it is asked for at all: the phone number is the only way into a
 * phone-signup account, and a number can be lost, changed, or left behind in
 * another country. The address gives the account a second, durable handle — and
 * is where every notification that is not WhatsApp-tier has to go.
 */
export function EmailVerify({
  initialEmail = '',
  alreadyVerified = false,
  onVerified,
}: EmailVerifyProps) {
  const t = useTranslations('onboarding.emailVerify');
  const tToast = useTranslations('toast');
  const { showToast } = useToast();

  const [stage, setStage] = useState<Stage>(alreadyVerified ? 'verified' : 'input');
  const [email, setEmail] = useState(initialEmail);
  const [otpKey, setOtpKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // A shape check only. The address is PROVEN by the code that follows, so
  // anything stricter here would reject valid addresses to no purpose.
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

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
    if (!looksLikeEmail) return;
    setError(null);
    setLoading(true);
    try {
      await postEmailVerifyStart(email.trim());
      setStage('otp');
      setOtpKey((k) => k + 1);
      startCooldown();
      // Only after the 200 — every failure below throws before reaching here,
      // so this can never claim a code was sent when it was not.
      showToast({ message: tToast('otpSent') });
    } catch (err) {
      /*
        The stage stays 'input' on every failure, so the send button remains and
        a retry costs one tap. Each message names a different next move: a taken
        address needs a different address, an outage needs a retry, a rate limit
        needs a wait — telling someone to "try again" while rate-limited is the
        one instruction guaranteed to keep failing.
      */
      const apiErr = err instanceof ApiRequestError ? err.error : null;
      const code = apiErr?.code ?? null;
      if (code === 'EMAIL_ALREADY_REGISTERED') setError(t('emailTaken'));
      else if (code === 'OTP_SEND_FAILED') setError(t('sendFailed'));
      else if (apiErr?.status === 429) setError(t('rateLimited'));
      else setError(t('sendError'));
    } finally {
      setLoading(false);
    }
  }, [email, looksLikeEmail, startCooldown, t, showToast, tToast]);

  const handleOtpComplete = useCallback(
    async (code: string) => {
      setError(null);
      setLoading(true);
      try {
        const result = await postEmailVerifyConfirm(email.trim(), code);
        setStage('verified');
        onVerified(result.email);
      } catch (err) {
        // The address can be claimed by someone else while this code is alive —
        // send them back to enter a different one rather than retrying a code
        // that can no longer succeed.
        if (err instanceof ApiRequestError && err.error.code === 'EMAIL_ALREADY_REGISTERED') {
          setError(t('emailTaken'));
          setStage('input');
        } else {
          setError(t('otpInvalid'));
          setOtpKey((k) => k + 1);
        }
      } finally {
        setLoading(false);
      }
    },
    [email, onVerified, t],
  );

  if (stage === 'verified') {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-success-fg/20 bg-success-bg p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
          <CheckCircle2 className="size-5 text-success-fg" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-success-fg">{t('verified')}</p>
          <p className="truncate text-xs text-neutral-600">{email}</p>
        </div>
        <button
          type="button"
          onClick={() => setStage('input')}
          className="ms-auto rounded text-xs font-medium text-neutral-600 underline hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('change')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-[22px] border border-neutral-200/70 bg-gradient-to-br from-neutral-50 to-[#E8F0FE]/40 p-5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-[#0F3D91]">
          <Mail className="size-4" aria-hidden="true" />
        </span>
        <p className="text-sm font-bold text-neutral-800">{t('title')}</p>
      </div>

      {/* Only while we are still ASKING. Once the code is on its way, "we'll
          send a code" sits above "enter the code we sent" — the screen would
          simultaneously promise to send one and ask for the one it already did.
          The same fix PhoneVerify carries. */}
      {stage === 'input' && <p className="text-xs text-neutral-600">{t('subtitle')}</p>}

      {stage === 'input' && (
        <div className="flex flex-wrap gap-2">
          <div className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
            <Label htmlFor="onboarding-email" required>
              {t('label')}
            </Label>
            <Input
              id="onboarding-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t('placeholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              disabled={loading}
              hasError={!!error}
              className="h-12 rounded-xl"
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              variant="secondary"
              size="md"
              loading={loading}
              disabled={!looksLikeEmail}
              onClick={handleSend}
              className="h-12 rounded-xl"
            >
              {t('send')}
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
              {cooldown > 0 ? t('resendIn', { seconds: cooldown }) : t('resend')}
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
              {t('change')}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs font-medium text-error-fg">
          {error}
        </p>
      )}
    </div>
  );
}
