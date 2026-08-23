'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, KeyRound, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PasswordField } from '@/components/auth/PasswordField';
import { postSetPassword } from '@/lib/auth/api';
import { ApiRequestError } from '@/lib/api/client';

interface SetPasswordProps {
  alreadySet?: boolean;
  onSet: () => void;
}

/**
 * The last step a phone-signup candidate owes: giving the account a password.
 *
 * ── Why it is required rather than offered ───────────────────────────────────
 * Until this runs, the account has exactly one way in: a WhatsApp code to one
 * phone number. Our candidates change SIMs between postings, lose handsets, and
 * leave numbers behind when they come home — and WhatsApp delivery is not
 * something we control. "Skip for now" would mean a candidate whose number
 * stops working has no route back to their own profile and documents, and no
 * support path that does not involve proving identity by hand.
 *
 * The strength rules are the signup rules; the field is the same PasswordField
 * the signup form uses, so the meter and the requirements read identically in
 * both places.
 */
export function SetPassword({ alreadySet = false, onSet }: SetPasswordProps) {
  const t = useTranslations('onboarding.setPassword');

  const [done, setDone] = useState(alreadySet);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirrors the API's rule exactly. Checking it here saves a round trip and a
  // rejection; the server still enforces it, and remains the authority.
  const strongEnough = password.length >= 8 && /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/.test(password);
  const matches = password === confirm;

  async function handleSubmit() {
    setError(null);
    if (!strongEnough) {
      setError(t('tooWeak'));
      return;
    }
    if (!matches) {
      setError(t('mismatch'));
      return;
    }

    setLoading(true);
    try {
      await postSetPassword(password);
      setDone(true);
      onSet();
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.error.code : null;
      if (code === 'PASSWORD_ALREADY_SET') {
        /*
          Not an error worth blocking on. The account has the credential this
          step exists to create — most likely set in another tab, or a retry
          after a response we never saw. Treating it as failure would trap the
          candidate on a step whose goal is already met.
        */
        setDone(true);
        onSet();
      } else if (code === 'VALIDATION_ERROR') {
        setError(t('tooWeak'));
      } else {
        setError(t('error'));
      }
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-success-fg/20 bg-success-bg p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
          <CheckCircle2 className="size-5 text-success-fg" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold text-success-fg">{t('done')}</p>
          <p className="text-xs text-neutral-600">{t('doneHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-[22px] border border-neutral-200/70 bg-gradient-to-br from-neutral-50 to-[#E8F0FE]/40 p-5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-[#0F3D91]">
          <KeyRound className="size-4" aria-hidden="true" />
        </span>
        <p className="text-sm font-bold text-neutral-800">{t('title')}</p>
      </div>
      <p className="text-xs text-neutral-600">{t('subtitle')}</p>

      <PasswordField
        id="onboarding-password"
        label={t('label')}
        value={password}
        placeholder={t('placeholder')}
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

      <PasswordField
        id="onboarding-password-confirm"
        label={t('confirmLabel')}
        value={confirm}
        placeholder={t('placeholder')}
        autoComplete="new-password"
        onChange={(e) => setConfirm(e.target.value)}
        startIcon={<Lock className="size-4" />}
      />

      <div>
        <Button
          type="button"
          variant="secondary"
          size="md"
          loading={loading}
          disabled={!password || !confirm}
          onClick={handleSubmit}
          className="h-12 rounded-xl"
        >
          {t('save')}
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-xs font-medium text-error-fg">
          {error}
        </p>
      )}
    </div>
  );
}
