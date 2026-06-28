'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { LoginForm } from '@/components/auth/LoginForm';
import { PhoneLoginFlow } from '@/components/auth/PhoneLoginFlow';
import { useAuth } from '@/lib/auth/auth-context';

type Method = 'email' | 'phone';

export default function LoginPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const { user } = useAuth();
  const [method, setMethod] = useState<Method>('email');

  // Already authenticated — redirect to dashboard
  if (user) {
    router.replace('/dashboard');
    return null;
  }

  function handleSuccess() {
    router.replace('/dashboard');
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-neutral-900">{t('loginTitle')}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t('loginSubtitle')}</p>
      </div>

      <GoogleButton label={t('googleLogin')} />

      {/* Divider */}
      <div className="relative flex items-center gap-3">
        <div className="flex-1 border-t border-neutral-200" />
        <span className="text-xs text-neutral-400 uppercase tracking-wider">{t('orDivider')}</span>
        <div className="flex-1 border-t border-neutral-200" />
      </div>

      {/* Method tabs */}
      <div className="flex rounded-md border border-border overflow-hidden text-sm">
        <button
          type="button"
          role="tab"
          aria-selected={method === 'email'}
          onClick={() => setMethod('email')}
          className={[
            'flex-1 py-2 font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
            method === 'email'
              ? 'bg-primary-50 text-primary-700 border-b-2 border-primary-600'
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
            'flex-1 py-2 font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
            method === 'phone'
              ? 'bg-primary-50 text-primary-700 border-b-2 border-primary-600'
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
          className="text-primary-600 font-medium hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {t('signupLink')}
        </Link>
      </p>
    </div>
  );
}
