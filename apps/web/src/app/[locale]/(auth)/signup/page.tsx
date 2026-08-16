'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { SignupForm } from '@/components/auth/SignupForm';
import { useAuth } from '@/lib/auth/auth-context';

export default function SignupPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  /*
    Where the visitor was headed before they hit the auth wall — set by the
    Apply buttons on the public job listings.

    Used ONLY to hand back to the sign-in link below, NOT to redirect after
    signup. A brand-new candidate cannot apply to anything yet: applying
    requires a completed profile and mandatory documents, so sending them
    straight to a job would land them on a button that refuses them, which is a
    worse first experience than the onboarding they actually need. Onboarding
    stays the destination; the parameter only survives the trip to sign-in for
    the people who turn out to have an account already.
  */
  const next = searchParams.get('next');
  // Prevents the "already authenticated" guard from firing after a successful
  // signup on this very page. signup() sets the user in context which re-renders
  // SignupPage — without this ref the guard would race and redirect to /dashboard
  // instead of letting handleSuccess() reach /onboarding.
  const postSignupRef = useRef(false);

  // Must run in an effect, not during render — see login/page.tsx for why.
  useEffect(() => {
    if (user && !postSignupRef.current) {
      router.replace('/dashboard');
    }
  }, [user, router]);

  if (user && !postSignupRef.current) {
    return null;
  }

  function handleSuccess(role: 'CANDIDATE' | 'EMPLOYER') {
    postSignupRef.current = true;
    // Employer goes through a separate onboarding flow (Screen 14, employer shell)
    router.replace(role === 'EMPLOYER' ? '/employer/onboarding' : '/onboarding');
  }

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-neutral-200/80 bg-white px-5 py-8 shadow-[0_12px_40px_-12px_rgba(15,61,145,0.18)] sm:px-9 sm:py-9">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-[#0F3D91] sm:text-3xl">{t('signupTitle')}</h1>
        <p className="mt-1.5 text-sm text-neutral-600 sm:text-base">{t('signupSubtitle')}</p>
      </div>

      {/* Google OAuth — candidates only; UI note included */}
      <div className="flex flex-col gap-1.5">
        <GoogleButton
          label={t('googleSignup')}
          className="h-12 rounded-xl border-neutral-300 font-semibold hover:border-neutral-400"
        />
        <p className="text-center text-xs text-neutral-600">{t('googleCandidateOnly')}</p>
      </div>

      {/* Divider */}
      <div className="relative flex items-center gap-3">
        <div className="flex-1 border-t border-neutral-200" />
        <span className="text-xs text-neutral-600 lowercase">{t('orDivider')}</span>
        <div className="flex-1 border-t border-neutral-200" />
      </div>

      <SignupForm onSuccess={handleSuccess} />

      <p className="text-center text-sm text-neutral-600">
        {t('hasAccount')}{' '}
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
          className="font-semibold text-[#0F3D91] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {t('loginLink')}
        </Link>
      </p>
    </div>
  );
}
