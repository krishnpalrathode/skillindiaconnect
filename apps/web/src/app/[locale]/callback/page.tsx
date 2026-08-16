'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { BrandLoaderPage } from '@/components/ui/brand-loader';

/**
 * OAuth callback — mounted by the browser after the provider redirects back.
 * The backend has already set the httpOnly refresh cookie.
 *
 * ── Why this route sits OUTSIDE the (auth) group ────────────────────────────
 * It used to live in `(auth)`, whose layout wraps its children in the
 * split-panel marketing shell — a gradient hero, a pull quote and a language
 * switcher. That shell is right for a page someone READS and fills in (log in,
 * sign up, reset password). It is wrong here: this route paints for the half
 * second between Google returning and the dashboard mounting, and dressing that
 * instant as a landing page makes a redirect look like a destination. Worse, the
 * quote in that shell is hardcoded English, so a Hindi or Arabic user was shown
 * an English marketing panel mid-sign-in.
 *
 * Moving the folder out of the group changes NO url — `(auth)` is a route group
 * and contributes nothing to the path. `/en/callback` is still `/en/callback`.
 * `forgot-password` and `reset-password` stay in the group and keep that shell.
 *
 * ── Why there is no postRefresh() here ──────────────────────────────────────
 * AuthProvider's own bootstrap `doRefresh()` (mounted once at the root layout)
 * already redeems the refresh cookie. Calling it a second time here would race
 * it — the refresh flow is single-use with reuse-attack detection
 * (token.service.ts), so whichever concurrent call loses trips reuse detection
 * and revokes the session the winner just established. We wait for that one
 * bootstrap call to resolve.
 */
export default function OAuthCallbackPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && user) {
      router.replace('/dashboard');
    }
  }, [user, isLoading, router]);

  if (!isLoading && !user) {
    // Bootstrap finished and produced no session — the sign-in genuinely failed.
    // Centred on its own now that no layout supplies a frame.
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-medium text-neutral-700">{t('callbackError')}</p>
        <a
          href="/login"
          className="rounded text-sm text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          {t('backToLogin')}
        </a>
      </div>
    );
  }

  /*
    The app's own loader, not a hand-rolled ring. `label` is announced to screen
    readers but not painted — BrandLoader's contract — so there is no visible
    "Signing you in…" caption competing with the animation. min-h-svh keeps the
    mark optically centred on the full viewport, since nothing wraps this page.
  */
  return <BrandLoaderPage label={t('signingIn')} className="min-h-svh" />;
}
