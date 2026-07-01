import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { JobSearchControls } from '@/components/jobs/JobSearchControls';
import { JobFilters } from '@/components/jobs/JobFilters';
import { JobList } from '@/components/jobs/JobList';
import { searchJobsServer } from '@/lib/api/jobs';
import {
  buildJobSearchQuery,
  parseJobSearchParams,
  DEFAULT_PAGE_SIZE,
  type RawSearchParams,
} from '@/lib/jobs/searchParams';

interface JobsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawSearchParams>;
}

export async function generateMetadata({ params }: JobsPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'jobs' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export default async function JobsPage({ params, searchParams }: JobsPageProps) {
  const { locale } = await params;
  const rawParams = await searchParams;
  const filters = parseJobSearchParams(rawParams);
  const t = await getTranslations('jobs');

  // Fetch the first page on the server; the SSR result seeds JobList so the
  // page is fully populated in the initial HTML response (crawlable, no CLS).
  const initialData = await searchJobsServer(filters, { limit: DEFAULT_PAGE_SIZE });

  // A stable string that changes whenever any filter changes — used as the
  // `key` prop on JobList to force a remount when the user applies filters,
  // resetting the component's cursor/job-list state to the new SSR data.
  const queryKey = buildJobSearchQuery(filters) || 'default';

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900 sm:text-3xl">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t('pageSubtitle')}</p>
      </header>

      <JobSearchControls filters={filters} />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <aside aria-label={t('filtersLabel')}>
          <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
            <JobFilters filters={filters} locale={locale} />
          </div>
        </aside>

        <div>
          <JobList key={queryKey} initialData={initialData} filters={filters} locale={locale} />
        </div>
      </div>
    </main>
  );
}
