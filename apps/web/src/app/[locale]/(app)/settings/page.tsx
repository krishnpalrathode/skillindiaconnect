'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import type { components } from '@skillindiaconnect/shared-types';
import { BrandLoader } from '@/components/ui/brand-loader';
import { AccountSettingsSection } from '@/components/profile/sections/AccountSettingsSection';
import { getCandidateProfile } from '@/lib/api/candidate';
import { useAuth } from '@/lib/auth/auth-context';
import { homePathForRole } from '@/lib/auth/home-path';
import { ApiRequestError } from '@/lib/api/client';
import { PAGE_SHELL } from '@/lib/page-shell';

type CandidateProfile = components['schemas']['CandidateProfile'];

/**
 * The STANDALONE Settings destination.
 *
 * The nav's Settings item used to deep-link to `/profile#account-settings`,
 * which meant clicking it loaded the entire profile page and lit up "Profile"
 * in the sidebar — the item could never show as current, because the URL it
 * landed on WAS the profile route. A nav destination needs its own route to
 * have its own active state.
 *
 * A THIN ROUTE WRAPPER, following the /resume precedent: `AccountSettingsSection`
 * is the whole feature and is still mounted by the profile page too, so there is
 * exactly one implementation of the settings controls. Everything here is route
 * concerns only — role scoping, fetching the profile the section takes as a
 * prop, and the page framing the profile page would otherwise provide.
 *
 * Auth: the (app) layout already redirects unauthenticated users (this path is
 * not in its `isPublicPath` allowance), so there is no second gate here — only
 * the wrong-ROLE case, which the layout does not cover.
 */
export default function SettingsPage() {
  const t = useTranslations('profile');
  const tNav = useTranslations('nav');
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'CANDIDATE') {
      // setLoading(false) BEFORE the redirect: if the navigation does not land,
      // the page must show an error rather than sit on a spinner forever.
      setLoading(false);
      router.replace(homePathForRole(user.role, locale));
      return;
    }

    getCandidateProfile()
      .then(setProfile)
      .catch((err) => {
        if (err instanceof ApiRequestError && err.error.code === 'NOT_FOUND') {
          // No profile yet — there are no settings to change. Onboarding first.
          router.replace(`/${locale}/onboarding`);
        } else {
          setError(t('loadingError'));
        }
      })
      .finally(() => setLoading(false));
  }, [user, locale, router, t]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <BrandLoader size="lg" label={t('loading')} />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
        <p className="text-center text-neutral-600">{error ?? t('loadingError')}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-sm text-primary-600 underline"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  return (
    <div className={PAGE_SHELL}>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-neutral-900 sm:text-3xl">{tNav('settings')}</h1>
        <p className="text-sm text-neutral-600">{t('settingsPageSubtitle')}</p>
      </header>

      <AccountSettingsSection profile={profile} onProfileUpdate={setProfile} />
    </div>
  );
}
