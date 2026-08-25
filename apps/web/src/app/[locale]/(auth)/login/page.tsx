'use client';

import { Suspense, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { LinkedinButton } from '@/components/auth/LinkedinButton';
import { OAuthErrorNotice } from '@/components/auth/OAuthErrorNotice';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { LoginForm } from '@/components/auth/LoginForm';
import { PhoneLoginFlow } from '@/components/auth/PhoneLoginFlow';
import { useAuth } from '@/lib/auth/auth-context';
import { homePathForRole } from '@/lib/auth/home-path';

type Method = 'email' | 'phone';

/**
 * 'forgot' swaps the reset form in place of the whole sign-in panel — no
 * navigation, so the surrounding card and hero stay put.
 */
type View = 'signIn' | 'forgot';

export default function LoginPage() {
  // useSearchParams() opts the subtree into client-side rendering, and Next
  // fails the production build unless it sits under a Suspense boundary.
  return (
    <Suspense fallback={<div className="h-48" aria-hidden />}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const { user } = useAuth();
  const [method, setMethod] = useState<Method>('email');
  const [view, setView] = useState<View>('signIn');

  // `next` lets callers (e.g. SaveJobButton on a public job page) send the
  // candidate back to where they were instead of always landing on /dashboard.
  const next = searchParams.get('next');

  /*
    A failed provider sign-in comes back HERE, as ?error=CODE — the OAuth
    callback is a browser redirect, so the API has nowhere to put an error but
    the URL. Before this the codes were sent and nothing read them, leaving a
    refused user on a login page that gave no reason.
  */
  const oauthError = searchParams.get('error');

  // Already authenticated — redirect to dashboard.
  // Must run in an effect, not during render: calling router.replace() while
  // LoginPage is rendering updates the Router component mid-render, which
  // React flags as "Cannot update a component while rendering a different component".
  // Route by ROLE, not to a hardcoded candidate dashboard.
  //
  // This previously sent every successful sign-in to `/dashboard`, which is the
  // CANDIDATE dashboard. An admin landed there, that screen's guard bounced any
  // non-candidate to `/employer/onboarding`, and a SUPER_ADMIN ended up stranded
  // on an employer registration form — while the admin console sat there,
  // working, with nothing routing anyone to it.
  useEffect(() => {
    if (user) {
      router.replace(next || homePathForRole(user.role, locale));
    }
  }, [user, next, router, locale]);

  if (user) {
    return null;
  }

  /**
   * Deliberately does NOT redirect.
   *
   * `login()` sets the user on the auth context, so the effect above fires with
   * the freshly-known ROLE and routes there. Redirecting here as well raced it:
   * this callback runs before the context state has propagated, so it only had
   * a stale role to work from — which is how everyone ended up at the candidate
   * dashboard. One redirect path, one source of truth for the role.
   */
  function handleSuccess() {
    // no-op — the role-aware effect above performs the navigation
  }

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-neutral-200/80 bg-white px-5 py-8 shadow-[0_12px_40px_-12px_rgba(15,61,145,0.18)] sm:px-9 sm:py-9">
      {/* Official logo replaces the visible title per the approved design; the
          h1 stays in the accessibility tree (sr-only) so the page keeps its
          heading for screen readers. The logo canvas has transparent margins —
          the fixed-ratio wrapper crops to the artwork band. */}
      <div className="text-center">
        {/* ForgotPasswordForm renders its own visible h1 — emitting this one too
            would leave the page with two h1s in the reset view. */}
        {view === 'signIn' && <h1 className="sr-only">{t('loginTitle')}</h1>}
        <div className="relative mx-auto h-[96px] w-[270px]">
          <Image
            src="/brand/logo.png"
            alt="SkillIndia Connect — Elevating Skills, Connecting Futures"
            fill
            priority
            sizes="270px"
            className="object-cover"
          />
        </div>
      </div>

      {/* Reset flow replaces the sign-in panel IN PLACE — same page, same card,
          no route change. The logo above stays so the screen keeps its identity. */}
      {view === 'forgot' ? (
        <ForgotPasswordForm onBackToLogin={() => setView('signIn')} />
      ) : (
        <>
          <OAuthErrorNotice code={oauthError} />

          <div className="flex flex-col gap-2.5">
            <GoogleButton
              label={t('googleLogin')}
              className="h-12 rounded-xl border-neutral-300 font-semibold hover:border-neutral-400"
            />
            <LinkedinButton
              label={t('linkedinLogin')}
              className="h-12 rounded-xl border-neutral-300 font-semibold hover:border-neutral-400"
            />
          </div>

          {/* Divider */}
          <div className="relative flex items-center gap-3">
            <div className="flex-1 border-t border-neutral-200" />
            <span className="text-xs text-neutral-600 uppercase tracking-wider">
              {t('orDivider')}
            </span>
            <div className="flex-1 border-t border-neutral-200" />
          </div>

          {/*
        Method tabs.

        A11Y-001 (S8-H4): these carried role="tab" with NO role="tablist"
        parent — an invalid ARIA structure (axe `aria-required-parent`, WCAG
        1.3.1). A screen reader announced "tab" with no group context and no
        position, so a user could not tell there were two choices or which they
        were on. The panel below is now bound with aria-controls/aria-labelledby
        so the relationship is programmatic, not just visual.
      */}
          <div
            role="tablist"
            aria-label={t('methodTabsLabel')}
            className="flex overflow-hidden rounded-xl border border-neutral-200 text-sm"
          >
            <button
              type="button"
              role="tab"
              id="login-tab-email"
              aria-selected={method === 'email'}
              aria-controls="login-panel-email"
              onClick={() => setMethod('email')}
              className={[
                'h-11 flex-1 font-semibold transition-colors',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
                method === 'email'
                  ? 'border-b-2 border-[#0F3D91] bg-[#eef4ff] text-[#0F3D91]'
                  : 'text-neutral-600 hover:bg-neutral-50',
              ].join(' ')}
            >
              {t('tabEmail')}
            </button>
            <button
              type="button"
              role="tab"
              id="login-tab-phone"
              aria-selected={method === 'phone'}
              aria-controls="login-panel-phone"
              onClick={() => setMethod('phone')}
              className={[
                'h-11 flex-1 font-semibold transition-colors',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
                method === 'phone'
                  ? 'border-b-2 border-[#0F3D91] bg-[#eef4ff] text-[#0F3D91]'
                  : 'text-neutral-600 hover:bg-neutral-50',
              ].join(' ')}
            >
              {t('tabPhone')}
            </button>
          </div>

          {/* A11Y-001: the panel each tab controls, named by its own tab. */}
          {method === 'email' ? (
            <div role="tabpanel" id="login-panel-email" aria-labelledby="login-tab-email">
              <LoginForm onSuccess={handleSuccess} onForgotPassword={() => setView('forgot')} />
            </div>
          ) : (
            <div role="tabpanel" id="login-panel-phone" aria-labelledby="login-tab-phone">
              {/* CR-WA W1.6: the escape hatch for a WhatsApp OTP that never
                  arrives. The page owns the method state, so the flow asks to
                  be switched rather than routing anywhere — the user keeps the
                  card, the locale and any `next` param they arrived with.
                  Switching to the email panel also puts the Google button back
                  in view above it, which is the route for the Google-signup
                  candidates who have no password at all. */}
              <PhoneLoginFlow
                onSuccess={handleSuccess}
                onUseAnotherMethod={() => setMethod('email')}
              />
            </div>
          )}

          <p className="text-center text-sm text-neutral-600">
            {t('noAccount')}{' '}
            <Link
              /*
                Carry `next` across to signup.

                Most people arriving here with a `next` came from an Apply
                button on a public job and have no account yet — so this link,
                not the form above it, is the one they actually need. Dropping
                the parameter here threw away the job they clicked at the exact
                moment they agreed to register for it.
              */
              href={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}
              className="font-semibold text-[#0F3D91] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
            >
              {t('signupLink')}
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
