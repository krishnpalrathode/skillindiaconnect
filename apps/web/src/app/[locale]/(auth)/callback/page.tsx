'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { postRefresh } from '@/lib/auth/api';
import { setAccessToken } from '@/lib/api/client';

// OAuth callback page: mounted by the browser after the provider redirects.
// The backend has already set the httpOnly refresh cookie.
// We hit /auth/refresh to get an access token, then redirect to dashboard.
export default function OAuthCallbackPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const called = useRef(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;

    postRefresh()
      .then((result) => {
        setAccessToken(result.accessToken);
        router.replace('/dashboard');
      })
      .catch(() => {
        setError(true);
      });
  }, [router]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-neutral-700 font-medium">{t('callbackError')}</p>
        <a
          href="/login"
          className="text-primary-600 text-sm hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {t('backToLogin')}
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Accessible spinner */}
      <div
        role="status"
        aria-label={t('signingIn')}
        className="size-10 rounded-full border-4 border-primary-200 border-t-primary-600 animate-spin"
      />
      <p className="text-sm text-neutral-500">{t('signingIn')}</p>
    </div>
  );
}
