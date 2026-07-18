'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import type { AdminDashboard } from '@/lib/api/admin';
import { formatSubunits } from '@/lib/money';
import { Card, CardContent } from '@/components/ui/card';

/**
 * One KPI. The accessible name carries the VALUE AND ITS MEANING together
 * ("Candidates: 128"), because a screen reader announcing a bare "128" next to a
 * bare "Candidates" leaves the listener to reassemble the pair themselves.
 */
function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p
          aria-hidden="true"
          className="text-xs font-medium uppercase tracking-wide text-neutral-500"
        >
          {label}
        </p>
        <p aria-hidden="true" className="mt-1 text-2xl font-bold tabular-nums text-neutral-900">
          {value}
        </p>
        <span className="sr-only">{`${label}: ${value}`}</span>
      </CardContent>
    </Card>
  );
}

/** Sum a status→count map. The server sends only the statuses it has. */
function total(counts: Record<string, number> | undefined): number {
  return Object.values(counts ?? {}).reduce((sum, n) => sum + n, 0);
}

/**
 * A status breakdown, rendered as "ACTIVE 22 · PAUSED 4 · …".
 *
 * Deliberately driven by the KEYS THE SERVER SENT, not a hardcoded status list.
 * A new JobStatus lands in the enum and shows up here without a frontend change —
 * and, more importantly, a status the server has zero of is simply absent rather
 * than being invented as a fake zero row.
 */
function Breakdown({ counts }: { counts: Record<string, number> | undefined }) {
  const entries = Object.entries(counts ?? {}).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;

  return (
    <p className="mt-1 text-xs text-neutral-500">
      {entries.map(([status, n], i) => (
        <span key={status}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          <span className="font-medium text-neutral-700">{n}</span> {status}
        </span>
      ))}
    </p>
  );
}

export function AdminKpis({ data }: { data: AdminDashboard }) {
  const t = useTranslations('admin.dashboard');

  const employers = data.counts.employers as Record<string, number>;
  const jobs = data.counts.jobs as Record<string, number>;
  const applications = data.counts.applications as Record<string, number>;

  return (
    <section aria-labelledby="admin-kpis-heading" className="flex flex-col gap-3">
      <h2 id="admin-kpis-heading" className="text-sm font-semibold text-neutral-700">
        {t('kpisHeading')}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label={t('candidates')} value={data.counts.candidates} />
        <Kpi label={t('employers')} value={total(employers)} />
        <Kpi label={t('jobs')} value={total(jobs)} />
        {/* Revenue arrives as INTEGER SUBUNITS and is formatted, never computed —
            the server owns every amount (money.ts). */}
        <Kpi
          label={t('revenueThisMonth')}
          value={formatSubunits(data.revenueThisMonthSubunits, data.currency, 'en')}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              {t('employersByStatus')}
            </p>
            <Breakdown counts={employers} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              {t('jobsByStatus')}
            </p>
            <Breakdown counts={jobs} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              {t('applicationsByStatus')}
            </p>
            <Breakdown counts={applications} />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
