'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import type { components } from '@skillindiaconnect/shared-types';
import { useAuth } from '@/lib/auth/auth-context';
import { getCandidateProfile, getCandidateCompletion } from '@/lib/api/candidate';
import { getCandidateStats } from '@/lib/api/dashboard';
import { listNotifications } from '@/lib/api/notifications';
import { searchJobsClient } from '@/lib/api/jobs';
import { ApiRequestError } from '@/lib/api/client';
import { EMPTY_FILTERS } from '@/lib/jobs/searchParams';
import { Spinner } from '@/components/ui/spinner';
import { KpiCards } from '@/components/dashboard/KpiCards';
import { ProfileSummaryCard } from '@/components/dashboard/ProfileSummaryCard';
import { RecommendedJobs } from '@/components/dashboard/RecommendedJobs';
import { MyApplicationsMini } from '@/components/dashboard/MyApplicationsMini';
import { QuickActions } from '@/components/dashboard/QuickActions';
import type { CandidateStats } from '@/lib/api/dashboard';

type CandidateProfile = components['schemas']['CandidateProfile'];
type CompletionResult = components['schemas']['CompletionResult'];
type JobCard = components['schemas']['JobCard'];

interface DashboardData {
  profile: CandidateProfile;
  completion: CompletionResult;
  stats: CandidateStats;
  unreadCount: number;
  recommendedJobs: JobCard[];
}

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
      router.replace(`/${locale}/onboarding/employer`);
      return;
    }

    Promise.all([
      getCandidateProfile(),
      getCandidateCompletion(),
      getCandidateStats(),
      listNotifications({ unread: true, limit: 50 }),
      searchJobsClient(EMPTY_FILTERS, { limit: 4 }),
    ])
      .then(([profile, completion, stats, unreadResult, jobsResult]) => {
        setData({
          profile,
          completion,
          stats,
          unreadCount: unreadResult.data.length,
          recommendedJobs: jobsResult.data,
        });
      })
      .catch((err) => {
        if (err instanceof ApiRequestError && err.error.status === 404) {
          router.replace(`/${locale}/onboarding`);
        } else {
          setError('Failed to load dashboard.');
        }
      })
      .finally(() => setLoading(false));
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

  const { profile, completion, stats, unreadCount, recommendedJobs } = data;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-bold text-neutral-900">
          {t('greeting', { name: profile.fullName?.split(' ')[0] ?? profile.email })}
        </h1>
      </header>

      <KpiCards stats={stats} unreadCount={unreadCount} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <ProfileSummaryCard profile={profile} completion={completion} />
          <div className="mt-4">
            <QuickActions />
          </div>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-6">
          <RecommendedJobs jobs={recommendedJobs} />
          <MyApplicationsMini />
        </div>
      </div>
    </div>
  );
}
