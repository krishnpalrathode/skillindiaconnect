'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import type { components } from '@skillindiaconnect/shared-types';
import { useAuth } from '@/lib/auth/auth-context';
import { getCandidateProfile, getCandidateCompletion } from '@/lib/api/candidate';
import { getCandidateStats } from '@/lib/api/dashboard';
import { getProfileViews, type ProfileViewsSummary } from '@/lib/api/profile-views';
import { listNotifications } from '@/lib/api/notifications';
import { searchJobsClient } from '@/lib/api/jobs';
import { ApiRequestError } from '@/lib/api/client';
import { EMPTY_FILTERS } from '@/lib/jobs/searchParams';
import { Spinner } from '@/components/ui/spinner';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { KpiCards } from '@/components/dashboard/KpiCards';
import { RecentViewersCard } from '@/components/dashboard/RecentViewersCard';
import { ProfileSummaryCard } from '@/components/dashboard/ProfileSummaryCard';
import { RecommendedJobs } from '@/components/dashboard/RecommendedJobs';
import { MyApplicationsMini } from '@/components/dashboard/MyApplicationsMini';
import { QuickActions } from '@/components/dashboard/QuickActions';
import type { CandidateStats } from '@/lib/api/dashboard';
import { homePathForRole } from '@/lib/auth/home-path';
import { PAGE_SHELL } from '@/lib/page-shell';

type CandidateProfile = components['schemas']['CandidateProfile'];
type CompletionResult = components['schemas']['CompletionResult'];
type JobCard = components['schemas']['JobCard'];

interface DashboardData {
  profile: CandidateProfile;
  completion: CompletionResult;
  stats: CandidateStats;
  unreadCount: number;
  recommendedJobs: JobCard[];
  // null when the profile-views fetch failed → KPI shows a quiet dash, never a
  // fabricated number.
  profileViews: ProfileViewsSummary | null;
}

const EMPTY_STATS: CandidateStats = { applied: 0, profileViews: 0, shortlisted: 0 };

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;

    if (user.role !== 'CANDIDATE') {
      // Their home, not employer onboarding — see home-path.ts. This screen was
      // the first stop after login for EVERY role, so sending non-candidates to
      // an employer registration form is what stranded admins.
      router.replace(homePathForRole(user.role, locale));
      return;
    }

    let redirected = false;

    // /me and /me/completion auto-create an empty profile on first access, so
    // they never 404 for a brand-new user — the onboarding-vs-dashboard call
    // has to come from the completion percentage itself (the same
    // server-computed single-source-of-truth value shown everywhere else),
    // not from catching a 404.
    Promise.all([getCandidateProfile(), getCandidateCompletion()])
      .then(async ([profile, completion]) => {
        if (completion.pct === 0) {
          redirected = true;
          router.replace(`/${locale}/onboarding`);
          return;
        }

        // stats/notifications/jobs are independent of the profile-exists
        // check above and shouldn't take the whole dashboard down if one
        // fails — notably /me/stats 404s until the Applications module ships.
        const [statsResult, unreadResult, jobsResult, profileViewsResult] =
          await Promise.allSettled([
            getCandidateStats(),
            listNotifications({ unread: true, pageSize: 50 }),
            searchJobsClient(EMPTY_FILTERS, { pageSize: 4 }),
            getProfileViews(),
          ]);

        setData({
          profile,
          completion,
          stats: statsResult.status === 'fulfilled' ? statsResult.value : EMPTY_STATS,
          unreadCount: unreadResult.status === 'fulfilled' ? unreadResult.value.data.length : 0,
          recommendedJobs: jobsResult.status === 'fulfilled' ? jobsResult.value.data : [],
          profileViews: profileViewsResult.status === 'fulfilled' ? profileViewsResult.value : null,
        });
      })
      .catch((err) => {
        if (err instanceof ApiRequestError && err.error.status === 404) {
          redirected = true;
          router.replace(`/${locale}/onboarding`);
        } else {
          setError('Failed to load dashboard.');
        }
      })
      .finally(() => {
        // Keep the spinner (not the error/empty state) showing while the
        // onboarding redirect is in flight instead of flashing "Failed to
        // load dashboard" for a frame.
        if (!redirected) setLoading(false);
      });
  }, [user, authLoading, locale, router]);

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner size={32} label={t('pageTitle')} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
        <p className="text-neutral-600 text-center">{error ?? 'Failed to load dashboard.'}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-sm text-primary-600 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const { profile, completion, stats, unreadCount, recommendedJobs, profileViews } = data;

  return (
    <div className={PAGE_SHELL}>
      <DashboardHeader
        name={profile.fullName ?? profile.email}
        photoUrl={profile.photoUrl}
        isAvailable={!!profile.isAvailable}
        unreadCount={unreadCount}
        locale={locale}
      />

      <KpiCards stats={stats} unreadCount={unreadCount} profileViews={profileViews} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-1">
          <ProfileSummaryCard profile={profile} completion={completion} />
          <QuickActions />
          {/* Recent profile views lives with the profile widgets in the sidebar
              — it is profile-engagement context, not top-of-fold content. The
              #recent-views anchor is preserved so the Profile Views KPI still
              links straight to it. */}
          <RecentViewersCard summary={profileViews} />
        </div>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <RecommendedJobs jobs={recommendedJobs} />
          <MyApplicationsMini />
        </div>
      </div>
    </div>
  );
}
