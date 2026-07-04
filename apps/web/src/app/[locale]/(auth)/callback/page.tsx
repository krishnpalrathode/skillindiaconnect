'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';

// OAuth callback page: mounted by the browser after the provider redirects.
// The backend has already set the httpOnly refresh cookie.
//
// This page does NOT call postRefresh() itself. AuthProvider's own bootstrap
// doRefresh() (mounted once at the root layout) already redeems the refresh
// cookie on mount. Calling postRefresh() a second time here would race it —
// the refresh-token flow is single-use with reuse-attack detection
// (token.service.ts), so whichever concurrent call loses the race trips
// reuse detection and revokes the whole session that the winner just
// established. We simply wait for that one bootstrap call to resolve.
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
