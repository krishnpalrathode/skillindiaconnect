import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { JobSearchControls } from '@/components/jobs/JobSearchControls';
import { JobFilters } from '@/components/jobs/JobFilters';
import { JobList } from '@/components/jobs/JobList';
import { searchJobsServer, getJobCountriesServer } from '@/lib/api/jobs';
import { PAGE_SHELL } from '@/lib/page-shell';
import {
  parseJobSearchParams,
  parsePageParam,
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
  const page = parsePageParam(rawParams);
  const t = await getTranslations('jobs');

  // Fetch the REQUESTED page on the server, so every page (not just the first)
  // is fully populated in the initial HTML response — crawlable, no CLS, and no
  // client-side refetch on navigation.
  // Both server-side and in parallel: the country strip must be populated in the
  // first HTML response, and a facet failure must not take the whole page down.
  const [pageData, countries] = await Promise.all([
    searchJobsServer(filters, { page, pageSize: DEFAULT_PAGE_SIZE }),
    getJobCountriesServer().catch(() => []),
  ]);

  return (
    <main className={PAGE_SHELL}>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900 sm:text-3xl">{t('pageTitle')}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t('pageSubtitle')}</p>
      </header>

      <JobSearchControls filters={filters} countries={countries} />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <aside aria-label={t('filtersLabel')}>
          <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
            <JobFilters filters={filters} locale={locale} />
          </div>
        </aside>

        <div>
          <JobList data={pageData} filters={filters} locale={locale} />
        </div>
      </div>
    </main>
  );
}
