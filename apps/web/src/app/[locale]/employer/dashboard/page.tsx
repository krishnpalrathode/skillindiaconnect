'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { useEmployer } from '@/lib/employer/employer-context';
import { getDashboard } from '@/lib/api/employer';
import { ApiRequestError } from '@/lib/api/client';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { EmployerKpis } from '@/components/employer/dashboard/EmployerKpis';
import { RecentJobsTable } from '@/components/employer/dashboard/RecentJobsTable';
import { RecentApplicants } from '@/components/employer/dashboard/RecentApplicants';
import { PostFirstJobCta } from '@/components/employer/dashboard/PostFirstJobCta';
import type { components } from '@skillindiaconnect/shared-types';

type EmployerDashboard = components['schemas']['EmployerDashboard'];

/**
 * Screen 15 — Employer Dashboard
 *
 * At S2, all KPI values are 0/empty (honest — not fabricated):
 *   - activeJobs: real count once S2-B5 ships; 0 for new employers
 *   - totalApplications, shortlisted, selected: 0 (applications are S4)
 *
 * The shell (layout.tsx) provides: company-state banner, sidebar/header/plan widget.
 * This page adds: greeting, KPIs, PostFirstJobCta (gated by approval), recent jobs/applicants.
 *
 * When company is null (employer has no company yet), redirect to onboarding.
 */
export default function EmployerDashboardPage() {
  const t = useTranslations('employer.dashboard');
  const { user } = useAuth();
  const { company, isLoading: companyLoading } = useEmployer();
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const [dashboard, setDashboard] = useState<EmployerDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Redirect to onboarding when company is null (employer hasn't registered yet)
  useEffect(() => {
    if (!companyLoading && company === null) {
      router.replace(`/${locale}/employer/onboarding`);
    }
  }, [companyLoading, company, router, locale]);

  useEffect(() => {
    if (companyLoading || company === null) return;
    if (company.status !== 'APPROVED') {
      // Company exists but not approved — dashboard API returns 403; show zeros
      setDashboard({
        kpis: { activeJobs: 0, totalApplications: 0, shortlisted: 0, selected: 0 },
        recentJobs: [],
        recentApplicants: [],
      });
      setLoading(false);
      return;
    }

    getDashboard()
      .then((data) => {
        setDashboard(data);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiRequestError && err.error.status === 403) {
          setDashboard({
            kpis: { activeJobs: 0, totalApplications: 0, shortlisted: 0, selected: 0 },
            recentJobs: [],
            recentApplicants: [],
          });
        } else {
          setError(t('errorLoad'));
        }
      })
      .finally(() => setLoading(false));
  }, [companyLoading, company, t]);

  const firstName = user?.email?.split('@')[0] ?? undefined;
  const greeting = firstName ? t('greeting', { name: firstName }) : t('greetingFallback');

  if (companyLoading || loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={28} label={t('loading')} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-sm text-neutral-500">{error}</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (!dashboard || !company) return null;

  const hasNoJobs = dashboard.recentJobs.length === 0;

  return (
    <div className="max-w-5xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">{greeting}</h1>
        <p className="text-sm text-neutral-500 mt-0.5">{company.name}</p>
      </div>

      <EmployerKpis kpis={dashboard.kpis} />

      {hasNoJobs && <PostFirstJobCta companyStatus={company.status} />}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <RecentJobsTable jobs={dashboard.recentJobs} />
        </div>
        <div className="lg:col-span-2">
          <RecentApplicants applicants={dashboard.recentApplicants} />
        </div>
      </div>
    </div>
  );
}
