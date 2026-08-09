'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import type { components } from '@skillindiaconnect/shared-types';
import { BrandLoader } from '@/components/ui/brand-loader';
import { ResumeExportHub } from '@/components/resume/ResumeExportHub';
import { getCandidateProfile } from '@/lib/api/candidate';
import { useAuth } from '@/lib/auth/auth-context';
import { homePathForRole } from '@/lib/auth/home-path';
import { ApiRequestError } from '@/lib/api/client';
import { PAGE_SHELL } from '@/lib/page-shell';

type CandidateProfile = components['schemas']['CandidateProfile'];

/**
 * CR-001 — the STANDALONE Resume Builder (the nav destination).
 *
 * A THIN ROUTE WRAPPER on purpose. `ResumeExportHub` is the whole feature —
 * preview, settings, generate→poll→download, delivery — and it is the SAME
 * component the onboarding stepper mounts (PreviewExportStep). Two copies of an
 * export hub is the maintenance trap this route exists to avoid, so everything
 * here is route concerns only: auth scoping, fetching the profile the hub takes
 * as its one prop, and the page framing the stepper would otherwise provide.
 *
 * The hub self-fetches resume info and completion, so this page deliberately
 * fetches ONLY the profile — adding a completion call here would duplicate a
 * request the hub already makes.
 *
 * Auth: the (app) layout already redirects unauthenticated users (this path is
 * not in its `isPublicPath` allowance), so there is no second gate here — only
 * the wrong-ROLE case, which the layout does not cover.
 */
export default function ResumeBuilderPage() {
  const t = useTranslations('resume');
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
      // Send them to THEIR home. setLoading(false) BEFORE the redirect: if the
      // navigation does not land, the page must show an error rather than sit
      // on a spinner forever (the /profile lesson, same shape).
      setLoading(false);
      router.replace(homePathForRole(user.role, locale));
      return;
    }

    getCandidateProfile()
      .then(setProfile)
      .catch((err) => {
        if (err instanceof ApiRequestError && err.error.code === 'NOT_FOUND') {
          // No profile yet — there is nothing to build a resume from. Onboarding
          // is the only useful destination.
          router.replace(`/${locale}/onboarding`);
        } else {
          setError(t('loadingError'));
        }
      })
      .finally(() => setLoading(false));
  }, [user, locale, router, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <BrandLoader size="lg" label={t('loading')} />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
        <p className="text-neutral-600 text-center">{error ?? t('loadingError')}</p>
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
      {/* The stepper gives the onboarding copy of this hub its context; standing
          alone it needs its own, or it reads as a widget with no page. */}
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-neutral-900 sm:text-3xl">{t('pageTitle')}</h1>
        <p className="text-sm text-neutral-600">{t('pageSubtitle')}</p>
      </header>

      <ResumeExportHub profile={profile} />
    </div>
  );
}
