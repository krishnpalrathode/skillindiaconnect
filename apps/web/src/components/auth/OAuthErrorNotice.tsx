'use client';

import { AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Explains a failed provider sign-in on the login page.
 *
 * The OAuth callback is a browser redirect, so the API cannot return an error
 * body — it can only put a code in the URL and send the user here. This turns
 * that code into copy in the user's own language.
 *
 * ── Why an allowlist, and not `t(\`oauthError.\${code}\`)` ───────────────────
 * `code` is raw URL input. Interpolating it straight into a translation key
 * lets anyone craft a link that renders an arbitrary key from the catalogue on
 * our login page — a phishing lure wearing our own styling ("Your account was
 * closed, call this number"). Only codes this component knows are rendered;
 * anything else falls back to the generic message.
 */

/** The codes the API actually sends. Keys map 1:1 to `auth.oauthError.*`. */
const KNOWN_CODES = [
  'GOOGLE_NOT_ALLOWED',
  'LINKEDIN_NOT_ALLOWED',
  'ACCOUNT_SUSPENDED',
  'LINKEDIN_NO_EMAIL',
  'LINKEDIN_EMAIL_UNVERIFIED',
  'LINKEDIN_PROFILE_FAILED',
  'LINKEDIN_FAILED',
  'LINKEDIN_UNAVAILABLE',
] as const;

type KnownCode = (typeof KNOWN_CODES)[number];

function isKnownCode(code: string): code is KnownCode {
  return (KNOWN_CODES as readonly string[]).includes(code);
}

interface OAuthErrorNoticeProps {
  /** The `?error=` query value, or null when the page was reached normally. */
  code: string | null;
}

export function OAuthErrorNotice({ code }: OAuthErrorNoticeProps) {
  const t = useTranslations('auth');

  if (!code) return null;

  const message = isKnownCode(code) ? t(`oauthError.${code}`) : t('oauthError.GENERIC');

  return (
    <div
      // `alert` so a screen reader announces it on arrival. The user did not
      // press anything on THIS page — they were redirected here — so nothing
      // else would tell them the sign-in failed.
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
    >
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-red-600" />
      <p>{message}</p>
    </div>
  );
}
