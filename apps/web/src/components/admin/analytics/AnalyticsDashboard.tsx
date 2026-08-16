'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Briefcase, Building2, CheckCircle2, Clock, Info, UserCheck } from 'lucide-react';
import { getAdminAnalytics, type AdminAnalytics } from '@/lib/api/admin-analytics';
import { ApiRequestError } from '@/lib/api/client';
import { ForbiddenState } from '@/components/admin/ForbiddenState';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatSubunits } from '@/lib/money';
import { ChartCard } from './ChartCard';
import { LineChart } from './LineChart';
import { StackedBars } from './StackedBars';
import { BarList } from './BarList';
import { Donut } from './Donut';
import { Funnel } from './Funnel';
import { KpiTile } from './KpiTile';
import { RangeFilter } from './RangeFilter';
import { SERIES, STATUS, fmtCompact, fmtFull, fmtPct } from './viz';

const DEFAULT_DAYS = 30;

/** The 'admin.dashboard.analytics' translator, threaded into the sections below. */
type T = ReturnType<typeof useTranslations<'admin.dashboard.analytics'>>;

/**
 * The admin analytics dashboard.
 *
 * Every number here is a live aggregate — nothing is a placeholder, and where the
 * platform genuinely cannot answer a question (job views, education, geography)
 * the section is ABSENT rather than filled with a plausible-looking invention.
 * The "What this dashboard can't tell you yet" panel names those gaps out loud,
 * because a missing chart that nobody explains gets re-requested forever, and a
 * fabricated one gets believed.
 */
export function AnalyticsDashboard() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations('admin.dashboard.analytics');
  const routeParams = useParams<{ locale: string }>();
  const locale = routeParams?.locale ?? 'en';

  const initialDays = Number(searchParams.get('days') ?? DEFAULT_DAYS) || DEFAULT_DAYS;
  const [days, setDays] = useState(initialDays);

  // ICU plural: 'previous 30 days' / 'previous 12 months', so the period a delta
  // is measured against is never an English fragment glued on in code.
  const period = t('previousPeriod', { days });

  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [isRefetching, setIsRefetching] = useState(false);
  const [error, setError] = useState<ApiRequestError | Error | null>(null);

  const load = useCallback(async (d: number, keepFrame: boolean) => {
    if (keepFrame) setIsRefetching(true);
    setError(null);
    try {
      setData(await getAdminAnalytics(d));
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsRefetching(false);
    }
  }, []);

  useEffect(() => {
    void load(days, false);
  }, [load, days]);

  const onRange = useCallback(
    (next: number) => {
      setDays(next);
      void load(next, true);
      // Native history, not router.replace: the range is pure client state, and
      // an RSC navigation here would remount the page and throw away the frame
      // we are deliberately holding during the refetch.
      const params = new URLSearchParams(searchParams.toString());
      params.set('days', String(next));
      window.history.replaceState(null, '', `${pathname}?${params.toString()}`);
    },
    [load, pathname, searchParams],
  );

  if (error instanceof ApiRequestError && error.error.status === 403) {
    return (
      <ForbiddenState
        requiredPermission={error.error.meta?.['requiredPermission'] as string | undefined}
      />
    );
  }

  // Never render a dashboard of zeros on a failed fetch — "0 pending reviews" and
  // "we couldn't ask" look identical and mean opposite things.
  if (error && !data) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 py-12">
        <p className="text-sm font-medium text-error-fg">{t('loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => void load(days, false)}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (!data) return <DashboardSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      {/* Filters: one row, above everything they scope. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangeFilter value={days} onChange={onRange} disabled={isRefetching} />
        <p className="text-xs text-neutral-600">
          {new Date(data.range.from).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
          })}{' '}
          –{' '}
          {new Date(new Date(data.range.to).getTime() - 86400000).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
          })}
        </p>
      </div>

      {/* Refetch keeps the frame: the previous render dims rather than collapsing
          into a skeleton, so nothing jumps as the numbers change. */}
      <div className={cn('flex flex-col gap-6 transition-opacity', isRefetching && 'opacity-60')}>
        <NeedsAttention data={data} locale={locale} t={t} />

        <section
          aria-label={t('kpi.heading')}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
        >
          <KpiTile
            label={t('kpi.candidates')}
            kpi={data.kpis.candidates}
            color={SERIES[0]}
            periodLabel={period}
          />
          <KpiTile
            label={t('kpi.employers')}
            kpi={data.kpis.employers}
            color={SERIES[1]}
            periodLabel={period}
          />
          <KpiTile
            label={t('kpi.jobs')}
            kpi={data.kpis.jobs}
            color={SERIES[2]}
            periodLabel={period}
          />
          <KpiTile
            label={t('kpi.applications')}
            kpi={data.kpis.applications}
            color={SERIES[3]}
            periodLabel={period}
          />
          <KpiTile
            label={t('kpi.hires')}
            kpi={data.kpis.hires}
            color={SERIES[4]}
            periodLabel={period}
          />
          {/* Revenue arrives as INTEGER SUBUNITS and is FORMATTED here, never
              computed — the server owns every amount (money.ts). */}
          <KpiTile
            label={t('kpi.revenue')}
            kpi={data.revenue}
            color={SERIES[0]}
            periodLabel={period}
            formatValue={(n) => formatSubunits(n, data.currency, locale)}
          />
        </section>

        <div className="grid gap-6 xl:grid-cols-3">
          <ChartCard
            className="xl:col-span-2"
            title={t('candidateGrowth.title')}
            subtitle={t('candidateGrowth.subtitle')}
            table={{
              columns: [
                t('chart.date'),
                t('candidateGrowth.registered'),
                t('candidateGrowth.verified'),
                t('candidateGrowth.active'),
              ],
              rows: data.candidateGrowth.map((p) => [
                String(p.date),
                Number(p.registrations ?? 0),
                Number(p.verified ?? 0),
                Number(p.active ?? 0),
              ]),
            }}
          >
            <LineChart
              points={data.candidateGrowth as Array<Record<string, unknown>>}
              series={[
                {
                  key: 'registrations',
                  label: t('candidateGrowth.registered'),
                  color: SERIES[0],
                  area: true,
                },
                { key: 'verified', label: t('candidateGrowth.verified'), color: SERIES[1] },
                { key: 'active', label: t('candidateGrowth.active'), color: SERIES[2] },
              ]}
            />
          </ChartCard>

          <ChartCard
            title={t('funnel.title')}
            subtitle={t('funnel.subtitle', { days })}
            note={t('funnel.note')}
            table={{
              columns: [
                t('funnel.stage'),
                t('funnel.count'),
                t('funnel.pctOfApplied'),
                t('funnel.fromPrevious'),
              ],
              rows: data.funnel.map((s) => [
                s.stage,
                s.count,
                fmtPct(s.pctOfTop),
                s.conversionFromPrev === null ? '—' : fmtPct(s.conversionFromPrev),
              ]),
            }}
          >
            <Funnel stages={data.funnel} />
          </ChartCard>
        </div>

        <ChartCard
          title={t('applicationTrend.title')}
          subtitle={t('applicationTrend.subtitle')}
          table={{
            columns: [
              t('chart.date'),
              t('applicationTrend.pending'),
              t('applicationTrend.shortlisted'),
              t('applicationTrend.selected'),
              t('applicationTrend.rejected'),
            ],
            rows: data.applicationTrend.map((p) => [
              String(p.date),
              Number(p.pending ?? 0),
              Number(p.shortlisted ?? 0),
              Number(p.selected ?? 0),
              Number(p.rejected ?? 0),
            ]),
          }}
        >
          <StackedBars
            points={data.applicationTrend as Array<Record<string, unknown>>}
            series={[
              { key: 'pending', label: t('applicationTrend.pending'), color: SERIES[0] },
              { key: 'shortlisted', label: t('applicationTrend.shortlisted'), color: SERIES[1] },
              { key: 'selected', label: t('applicationTrend.selected'), color: SERIES[2] },
              { key: 'rejected', label: t('applicationTrend.rejected'), color: SERIES[3] },
            ]}
          />
        </ChartCard>

        <div className="grid gap-6 xl:grid-cols-2">
          <ChartCard
            title={t('jobActivity.title')}
            subtitle={t('jobActivity.subtitle')}
            table={{
              columns: [
                t('chart.date'),
                t('jobActivity.created'),
                t('jobActivity.published'),
                t('jobActivity.archived'),
              ],
              rows: data.jobActivity.map((p) => [
                String(p.date),
                Number(p.created ?? 0),
                Number(p.published ?? 0),
                Number(p.archived ?? 0),
              ]),
            }}
          >
            <LineChart
              points={data.jobActivity as Array<Record<string, unknown>>}
              series={[
                { key: 'created', label: t('jobActivity.created'), color: SERIES[0], area: true },
                { key: 'published', label: t('jobActivity.published'), color: SERIES[2] },
              ]}
              height={200}
            />
          </ChartCard>

          <ChartCard
            title={t('employerGrowth.title')}
            subtitle={t('employerGrowth.subtitle')}
            table={{
              columns: [
                t('chart.date'),
                t('employerGrowth.registered'),
                t('employerGrowth.approved'),
              ],
              rows: data.employerGrowth.map((p) => [
                String(p.date),
                Number(p.registered ?? 0),
                Number(p.approved ?? 0),
              ]),
            }}
          >
            <LineChart
              points={data.employerGrowth as Array<Record<string, unknown>>}
              series={[
                {
                  key: 'registered',
                  label: t('employerGrowth.registered'),
                  color: SERIES[1],
                  area: true,
                },
                { key: 'approved', label: t('employerGrowth.approved'), color: SERIES[2] },
              ]}
              height={200}
            />
          </ChartCard>
        </div>

        <HiringEfficiency data={data} t={t} />

        <div className="grid gap-6 xl:grid-cols-3">
          <ChartCard
            title={t('breakdown.applicationsTitle')}
            subtitle={t('breakdown.allTime')}
            table={{
              columns: [t('breakdown.status'), t('breakdown.applications')],
              rows: data.applicationStatus.map((s) => [s.status, s.count]),
            }}
          >
            <Donut
              slices={data.applicationStatus.map((s) => ({
                label: titleCase(s.status),
                value: s.count,
              }))}
              centerLabel={t('breakdown.applications')}
            />
          </ChartCard>

          <ChartCard
            title={t('breakdown.employersTitle')}
            subtitle={t('breakdown.allTime')}
            table={{
              columns: [t('breakdown.status'), t('breakdown.employers')],
              rows: data.employerStatus.map((s) => [s.status, s.count]),
            }}
          >
            <Donut
              slices={data.employerStatus.map((s) => ({
                label: titleCase(s.status),
                value: s.count,
              }))}
              centerLabel={t('breakdown.employers')}
            />
          </ChartCard>

          <ChartCard
            title={t('breakdown.jobsTitle')}
            subtitle={t('breakdown.allTime')}
            table={{
              columns: [t('breakdown.status'), t('breakdown.jobs')],
              rows: data.jobStatus.map((s) => [s.status, s.count]),
            }}
          >
            <BarList
              items={data.jobStatus.map((s) => ({ label: titleCase(s.status), value: s.count }))}
              color={SERIES[0]}
              emptyMessage={t('chart.noData')}
            />
          </ChartCard>
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <ChartCard
            title={t('skills.title')}
            subtitle={t('skills.subtitle')}
            note={t('skills.note')}
            table={{
              columns: [t('skills.skill'), t('skills.candidates')],
              rows: data.topSkills.map((s) => [s.name, s.count]),
            }}
          >
            <BarList
              items={data.topSkills.map((s) => ({ label: s.name, value: s.count }))}
              color={SERIES[0]}
              emptyMessage={t('chart.noData')}
            />
          </ChartCard>

          <ChartCard
            title={t('experience.title')}
            subtitle={t('experience.subtitle')}
            table={{
              columns: [t('experience.band'), t('skills.candidates')],
              rows: data.demographics.experience.map((b) => [b.label, b.count]),
            }}
          >
            <BarList
              items={[...data.demographics.experience].sort(byExperienceBand).map(toBar)}
              color={SERIES[2]}
              emptyMessage={t('chart.noData')}
            />
          </ChartCard>

          <ChartCard
            title={t('age.title')}
            subtitle={t('age.subtitle')}
            note={t('age.note')}
            table={{
              columns: [t('experience.band'), t('skills.candidates')],
              rows: data.demographics.age.map((b) => [b.label, b.count]),
            }}
          >
            <BarList
              items={[...data.demographics.age].sort(byAgeBand).map(toBar)}
              color={SERIES[3]}
              emptyMessage={t('chart.noData')}
            />
          </ChartCard>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <ChartCard
            title={t('topEmployers.title')}
            subtitle={t('topEmployers.subtitle')}
            note={t('topEmployers.note')}
          >
            <RankTable
              head={[
                t('topEmployers.company'),
                t('topEmployers.activeJobs'),
                t('topEmployers.applications'),
                t('topEmployers.hires'),
                t('topEmployers.success'),
              ]}
              rows={data.topEmployers.map((e) => [
                e.name,
                fmtFull(e.activeJobs),
                fmtFull(e.applications),
                fmtFull(e.hires),
                fmtPct(e.successRate),
              ])}
              emptyMessage={t('topEmployers.empty')}
            />
          </ChartCard>

          <ChartCard
            title={t('topJobs.title')}
            subtitle={t('topJobs.subtitle')}
            note={t('topJobs.note')}
          >
            <RankTable
              textCols={2}
              head={[
                t('topJobs.job'),
                t('topJobs.employer'),
                t('topJobs.applied'),
                t('topJobs.shortlisted'),
                t('topJobs.hires'),
              ]}
              rows={data.topJobs.map((j) => [
                j.title,
                j.employerName,
                fmtFull(j.applications),
                fmtFull(j.shortlisted),
                fmtFull(j.hires),
              ])}
              emptyMessage={t('topJobs.empty')}
            />
          </ChartCard>
        </div>

        <Gaps t={t} />
      </div>
    </div>
  );
}

/* ── Sections ─────────────────────────────────────────────────────────────── */

/**
 * The work waiting on a human — FIRST, above the statistics.
 *
 * Severity is carried by an icon and a label as well as by color, because two of
 * the four status hues sit below 3:1 on white by design and are never allowed to
 * carry meaning alone.
 */
function NeedsAttention({ data, locale, t }: { data: AdminAnalytics; locale: string; t: T }) {
  const n = data.needsAttention;
  // Each queue deep-links WITH its status filter, so the click lands on the
  // pending rows rather than on an unfiltered list the admin then has to filter
  // themselves. The locale prefix is mandatory — every admin route is under it.
  const items = [
    {
      label: t('attention.employers'),
      value: n.pendingEmployerReviews,
      href: `/${locale}/admin/employers?status=PENDING`,
      icon: Building2,
      severity: n.pendingEmployerReviews > 0 ? 'critical' : 'good',
    },
    {
      label: t('attention.jobs'),
      value: n.pendingJobReviews,
      href: `/${locale}/admin/jobs?status=PENDING_REVIEW`,
      icon: Briefcase,
      severity: n.pendingJobReviews > 0 ? 'serious' : 'good',
    },
    {
      label: t('attention.applications'),
      value: n.pendingApplications,
      href: `/${locale}/admin/applications?status=PENDING`,
      icon: Clock,
      severity: n.pendingApplications > 0 ? 'warning' : 'good',
    },
    {
      label: t('attention.profiles', { threshold: n.completionThreshold }),
      value: n.incompleteProfiles,
      href: `/${locale}/admin/candidates`,
      icon: UserCheck,
      severity: 'warning',
    },
  ] as const;

  return (
    <section
      aria-label={t('attention.heading')}
      className="grid gap-3 rounded-2xl border border-neutral-200/70 bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-4"
    >
      {items.map((item) => {
        const clear = item.value === 0;
        const color = clear ? STATUS.good : STATUS[item.severity as keyof typeof STATUS];
        const Icon = clear ? CheckCircle2 : item.icon;
        return (
          <a
            key={item.label}
            href={item.href}
            // The count is IN the accessible name: a screen-reader user should
            // not have to read the number and the label as two unrelated nodes.
            aria-label={`${item.label}: ${clear ? t('attention.nothingWaiting') : fmtFull(item.value)}`}
            className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${color}1a`, color }}
            >
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-lg font-semibold leading-none text-neutral-900">
                {clear ? t('attention.clear') : fmtCompact(item.value)}
              </span>
              <span className="mt-1 block truncate text-xs text-neutral-600">{item.label}</span>
            </span>
          </a>
        );
      })}
    </section>
  );
}

/** Time-to-hire and conversion — stat tiles, because these are single numbers. */
function HiringEfficiency({ data, t }: { data: AdminAnalytics; t: T }) {
  const e = data.efficiency;
  const tiles = [
    {
      label: t('efficiency.daysToShortlist'),
      value: e.daysToShortlist === null ? '—' : `${e.daysToShortlist}`,
      hint: t('efficiency.daysToShortlistHint'),
    },
    {
      label: t('efficiency.daysToHire'),
      value: e.daysToHire === null ? '—' : `${e.daysToHire}`,
      hint: t('efficiency.daysToHireHint'),
    },
    {
      label: t('efficiency.hireRate'),
      value: fmtPct(e.hireRate),
      hint: t('efficiency.hireRateHint'),
    },
    {
      label: t('efficiency.applicationsPerJob'),
      value: `${e.applicationsPerJob}`,
      hint: t('efficiency.applicationsPerJobHint'),
    },
  ];

  return (
    <section
      aria-label={t('efficiency.title')}
      className="grid gap-4 rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-sm sm:grid-cols-2 xl:grid-cols-4"
    >
      <div className="sm:col-span-2 xl:col-span-4">
        <h3 className="text-sm font-semibold text-neutral-900">{t('efficiency.title')}</h3>
        <p className="mt-0.5 text-xs text-neutral-600">{t('efficiency.subtitle')}</p>
      </div>
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl bg-[#F5F8FC] p-4">
          <p className="text-2xl font-semibold leading-none text-neutral-900">{t.value}</p>
          <p className="mt-2 text-xs font-medium text-neutral-700">{t.label}</p>
          <p className="mt-0.5 text-[11px] text-neutral-600">{t.hint}</p>
        </div>
      ))}
    </section>
  );
}

/**
 * What this dashboard deliberately does NOT show.
 *
 * Each of these was in the original design and each would have required inventing
 * data. Naming them is cheaper than being asked for them every quarter, and far
 * cheaper than shipping a number nobody can reproduce.
 */
function Gaps({ t }: { t: T }) {
  const gaps = [
    [t('gaps.viewsTitle'), t('gaps.viewsWhy')],
    [t('gaps.educationTitle'), t('gaps.educationWhy')],
    [t('gaps.mapTitle'), t('gaps.mapWhy')],
    [t('gaps.funnelTitle'), t('gaps.funnelWhy')],
  ];

  return (
    <section className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
        <Info className="size-4 text-neutral-600" aria-hidden="true" />
        {t('gaps.title')}
      </h3>
      <p className="mt-1 text-xs text-neutral-600">{t('gaps.subtitle')}</p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {gaps.map(([title, why]) => (
          <div key={title} className="rounded-xl bg-[#F5F8FC] p-3">
            <dt className="text-xs font-semibold text-neutral-800">{title}</dt>
            <dd className="mt-0.5 text-[11px] leading-relaxed text-neutral-600">{why}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ── Small pieces ─────────────────────────────────────────────────────────── */

/**
 * `textCols` is how many LEADING columns are prose; the rest are numbers.
 *
 * Without it, "Top performing jobs" right-aligned its employer names and gave
 * them `tabular-nums`, so a long company name wrapped into three ragged lines
 * against the numbers. Text columns truncate on one line with the full value in
 * `title`; number columns stay nowrap and right-aligned so the digits line up.
 */
function RankTable({
  head,
  rows,
  emptyMessage,
  textCols = 1,
}: {
  head: string[];
  rows: string[][];
  emptyMessage: string;
  textCols?: number;
}) {
  if (rows.length === 0) return <p className="py-6 text-sm text-neutral-600">{emptyMessage}</p>;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[30rem] table-fixed text-sm">
        <thead>
          <tr className="border-b border-neutral-200">
            {head.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={cn(
                  'whitespace-nowrap py-2 text-xs font-medium text-neutral-600',
                  i < textCols ? 'text-start' : 'w-[5.5rem] text-end',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-neutral-100 last:border-0">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={cn(
                    'py-2',
                    ci < textCols
                      ? 'truncate pe-3'
                      : 'whitespace-nowrap text-end tabular-nums text-neutral-700',
                    ci === 0 && 'font-medium text-neutral-900',
                    ci > 0 && ci < textCols && 'text-neutral-700',
                  )}
                  title={ci < textCols ? cell : undefined}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <Skeleton className="h-10 w-72 rounded-xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Skeleton className="h-80 rounded-2xl xl:col-span-2" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
      <Skeleton className="h-80 w-full rounded-2xl" />
    </div>
  );
}

/** The API speaks {label,count}; BarList speaks {label,value}. One adapter, not two shapes. */
function toBar(b: { label: string; count: number }) {
  return { label: b.label, value: b.count };
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Buckets come back from a GROUP BY in whatever order Postgres feels like. These
// are ORDERED categories, so the chart must impose the order — an experience
// chart that reads 5-10, 0-2, 10+, 2-5 is unreadable regardless of its colors.
const EXPERIENCE_ORDER = ['0-2 years', '2-5 years', '5-10 years', '10+ years'];
const AGE_ORDER = ['18-25', '26-35', '36-45', '45+', 'Not given'];

function byOrder(order: string[]) {
  return (a: { label: string }, b: { label: string }) => {
    const ia = order.indexOf(a.label);
    const ib = order.indexOf(b.label);
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
  };
}
const byExperienceBand = byOrder(EXPERIENCE_ORDER);
const byAgeBand = byOrder(AGE_ORDER);
