import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, SearchX } from 'lucide-react';
import { JobCard } from '@/components/jobs/JobCard';
import type { components } from '@skillindiaconnect/shared-types';

type JobCardType = components['schemas']['JobCard'];

/** Three is what fits above the fold-and-a-bit without becoming a list. */
const MAX_FEATURED = 3;

/**
 * The newest live jobs, rendered with the SAME card the search results use.
 *
 * ── What "featured" means here, precisely ───────────────────────────────────
 * MOST RECENTLY PUBLISHED. Not a ranking, not a guess.
 *
 * There IS an admin-set `isFeatured` flag on the Job model, and it would have
 * been the better answer — but it is exposed only on the admin job shapes, not
 * on the public `JobCard`, and the public search has no `featured` filter. Using
 * it would mean widening the API, which this unit does not do. So these are the
 * jobs the search returns under its own default sort (`recent`), which is both
 * true and the thing a returning candidate most wants: what is new since last
 * time.
 *
 * ── No new data ────────────────────────────────────────────────────────────
 * The array is the dashboard's existing `recommendedJobs` fetch, handed
 * straight through. No second request, no new endpoint.
 *
 * ── The empty state is honest ──────────────────────────────────────────────
 * If there are no active jobs it says so and offers the search. It never renders
 * a placeholder card: a fabricated listing on a job board is not a loading
 * skeleton, it is a lie to someone looking for work.
 */
export function FeaturedJobs({ jobs, locale }: { jobs: JobCardType[]; locale: string }) {
  const t = useTranslations('home.featured');
  const shown = jobs.slice(0, MAX_FEATURED);

  return (
    <section aria-labelledby="home-featured-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2
          id="home-featured-heading"
          className="text-base font-bold leading-snug text-neutral-900"
        >
          {t('heading')}
        </h2>
        <Link
          href={`/${locale}/jobs`}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded px-1 text-sm font-semibold text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          {t('viewAll')}
          {/* rtl:rotate-180 — an arrow meaning "onward" points the other way in
              Arabic, and an un-flipped one reads as "back". */}
          <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </Link>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-neutral-300 bg-white px-5 py-8 text-center">
          <span
            aria-hidden="true"
            className="flex size-11 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600"
          >
            <SearchX className="size-5" />
          </span>
          <p className="text-sm font-semibold text-neutral-900">{t('emptyTitle')}</p>
          <p className="text-xs leading-snug text-neutral-600">{t('emptyBody')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {shown.map((job) => (
            <li key={job.id}>
              <JobCard job={job} locale={locale} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
