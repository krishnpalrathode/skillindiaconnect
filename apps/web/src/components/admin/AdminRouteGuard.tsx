'use client';

import React, { useEffect } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth/auth-context';
import { Spinner } from '@/components/ui/spinner';

/**
 * Admin-side roles only.
 *
 * SUPPORT is deliberately NOT here — per the S6a-F1 spec the console admits
 * {SUPER_ADMIN, ADMIN, MODERATOR}. Flagged: SUPPORT holds real grants in the seed
 * (candidates.view, employers.view, jobs.view, reports.view) that they currently
 * have no way to exercise, which is worth resolving before S6b.
 */
const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'] as const;

/**
 * Gates the whole (admin) tree.
 *
 * Two distinct outcomes, on purpose:
 *
 *  - NOT LOGGED IN → send them to login with a `next` back to where they were
 *    aiming. Nothing to explain; they just need to authenticate.
 *
 *  - LOGGED IN AS THE WRONG ROLE (a candidate or employer) → do NOT silently
 *    bounce them into their own shell. Being teleported somewhere you didn't ask
 *    for, with no explanation, reads as a bug — you're left wondering whether you
 *    clicked the wrong thing or the app is broken. Tell them plainly that this
 *    area isn't theirs, and offer the way back. Say what happened.
 */
export function AdminRouteGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';
  const t = useTranslations('admin.guard');

  const isAdmin = !!user && (ADMIN_ROLES as readonly string[]).includes(user.role);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      // `next` is WHERE THEY WERE AIMING — hardcoding the dashboard here loses
      // every admin deep link through a login round-trip (S6 pass finding).
      const next = pathname ?? `/${locale}/admin/dashboard`;
      router.replace(`/${locale}/login?next=${encodeURIComponent(next)}`);
    }
    // A wrong-role user is NOT redirected — see the not-authorized panel below.
  }, [user, isLoading, router, locale, pathname]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-neutral-50">
        <Spinner size={32} label={t('checking')} />
      </div>
    );
  }

  if (!isAdmin) {
    const home = user.role === 'EMPLOYER' ? `/${locale}/employer/dashboard` : `/${locale}/profile`;
    return (
      <div
        role="alert"
        className="flex min-h-svh flex-col items-center justify-center gap-4 bg-neutral-50 px-4 text-center"
      >
        <h1 className="text-xl font-semibold text-neutral-900">{t('notAuthorizedTitle')}</h1>
        <p className="max-w-md text-sm text-neutral-600">{t('notAuthorizedBody')}</p>
        <a
          href={home}
          className="text-sm font-medium text-primary-700 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {t('backHome')}
        </a>
      </div>
    );
  }

  return <>{children}</>;
}
