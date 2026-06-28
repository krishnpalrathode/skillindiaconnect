'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { SignupForm } from '@/components/auth/SignupForm';
import { useAuth } from '@/lib/auth/auth-context';

export default function SignupPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const { user } = useAuth();
  // Prevents the "already authenticated" guard from firing after a successful
  // signup on this very page. signup() sets the user in context which re-renders
  // SignupPage — without this ref the guard would race and redirect to /dashboard
  // instead of letting handleSuccess() reach /onboarding.
  const postSignupRef = useRef(false);

  if (user && !postSignupRef.current) {
    router.replace('/dashboard');
    return null;
  }

  function handleSuccess(role: 'CANDIDATE' | 'EMPLOYER') {
    postSignupRef.current = true;
    // Employer goes through a separate onboarding flow
    router.replace(role === 'EMPLOYER' ? '/onboarding/employer' : '/onboarding');
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-neutral-900">{t('signupTitle')}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t('signupSubtitle')}</p>
      </div>

      {/* Google OAuth — candidates only; UI note included */}
      <div className="flex flex-col gap-1.5">
        <GoogleButton label={t('googleSignup')} />
        <p className="text-center text-xs text-neutral-400">{t('googleCandidateOnly')}</p>
      </div>

      {/* Divider */}
      <div className="relative flex items-center gap-3">
        <div className="flex-1 border-t border-neutral-200" />
        <span className="text-xs text-neutral-400 uppercase tracking-wider">{t('orDivider')}</span>
        <div className="flex-1 border-t border-neutral-200" />
      </div>

      <SignupForm onSuccess={handleSuccess} />

      <p className="text-center text-sm text-neutral-600">
        {t('hasAccount')}{' '}
        <Link
          href="/login"
          className="text-primary-600 font-medium hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {t('loginLink')}
        </Link>
      </p>
    </div>
  );
}
