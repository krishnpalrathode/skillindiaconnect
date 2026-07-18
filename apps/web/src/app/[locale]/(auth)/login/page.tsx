'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { LoginForm } from '@/components/auth/LoginForm';
import { PhoneLoginFlow } from '@/components/auth/PhoneLoginFlow';
import { useAuth } from '@/lib/auth/auth-context';

type Method = 'email' | 'phone';

export default function LoginPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [method, setMethod] = useState<Method>('email');

  // `next` lets callers (e.g. SaveJobButton on a public job page) send the
  // candidate back to where they were instead of always landing on /dashboard.
  const next = searchParams.get('next');

  // Already authenticated — redirect to dashboard.
  // Must run in an effect, not during render: calling router.replace() while
  // LoginPage is rendering updates the Router component mid-render, which
  // React flags as "Cannot update a component while rendering a different component".
  useEffect(() => {
    if (user) {
      router.replace(next || '/dashboard');
    }
  }, [user, next, router]);

  if (user) {
    return null;
  }

  function handleSuccess() {
    router.replace(next || '/dashboard');
  }

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-neutral-200/80 bg-white px-5 py-8 shadow-[0_12px_40px_-12px_rgba(15,61,145,0.18)] sm:px-9 sm:py-9">
      {/* Official logo replaces the visible title per the approved design; the
          h1 stays in the accessibility tree (sr-only) so the page keeps its
          heading for screen readers. The logo canvas has transparent margins —
          the fixed-ratio wrapper crops to the artwork band. */}
      <div className="text-center">
        <h1 className="sr-only">{t('loginTitle')}</h1>
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

      <GoogleButton
        label={t('googleLogin')}
        className="h-12 rounded-xl border-neutral-300 font-semibold hover:border-neutral-400"
      />

      {/* Divider */}
      <div className="relative flex items-center gap-3">
        <div className="flex-1 border-t border-neutral-200" />
        <span className="text-xs text-neutral-400 uppercase tracking-wider">{t('orDivider')}</span>
        <div className="flex-1 border-t border-neutral-200" />
      </div>

      {/* Method tabs */}
      <div className="flex overflow-hidden rounded-xl border border-neutral-200 text-sm">
        <button
          type="button"
          role="tab"
          aria-selected={method === 'email'}
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
          aria-selected={method === 'phone'}
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

      {method === 'email' ? (
        <LoginForm onSuccess={handleSuccess} />
      ) : (
        <PhoneLoginFlow onSuccess={handleSuccess} />
      )}

      <p className="text-center text-sm text-neutral-600">
        {t('noAccount')}{' '}
        <Link
          href="/signup"
          className="font-semibold text-[#0F3D91] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {t('signupLink')}
        </Link>
      </p>
    </div>
  );
}
