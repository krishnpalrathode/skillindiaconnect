import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { getLandingJobsServer } from '@/lib/api/jobs';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';
import { PublicJobCard } from './PublicJobCard';

/**
 * The newest live jobs, shown to everyone — no account, no login wall.
 *
 * WHY THIS SECTION EXISTS, since it is the one part of the landing page that
 * costs a network call:
 *
 * A stranger arriving here is asking one question — "are there actually jobs on
 * this site?" — and every other section on the page answers a different one.
 * Categories, process diagrams and trust badges are all claims ABOUT the
 * marketplace; a list of ten real jobs with real salaries posted this week is
 * the marketplace itself. That is the difference between a brochure and a job
 * board, and it is what every board this product competes with leads with.
 *
 * It also does the acquisition work. These cards are server-rendered, so job
 * titles, salaries and locations are indexable, and a search for "electrician
 * job Dubai salary" can land a candidate here who has never heard of us. For a
 * job board that channel is not a nice-to-have — it is the main one.
 *
 * Renders NOTHING when there are no jobs (or the API is unreachable). An empty
 * "Latest jobs" heading over a blank strip is worse for a visitor than no
 * section at all: it says the marketplace is dead, which is the exact opposite
 * of what this block is here to say.
 */
export async function RecentJobs({ locale }: { locale: string }) {
  const [jobs, t] = await Promise.all([
    getLandingJobsServer(),
    getTranslations({ locale, namespace: 'landing.recentJobs' }),
  ]);

  if (jobs.length === 0) return null;

  return (
    <section aria-labelledby="recent-jobs-heading" className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <h2
              id="recent-jobs-heading"
              className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl"
            >
              {t('heading')}
            </h2>
            <p className="mt-2 text-base text-neutral-700">{t('subheading')}</p>
          </div>

          {/* Repeated at the top as well as the bottom: on mobile the ten cards
              are a long scroll, and a reader who decides early should not have
              to reach the end to act on it. */}
          <Link
            href={`/${locale}/jobs`}
            className="group hidden shrink-0 items-center gap-1 text-sm font-bold text-primary-700 hover:underline sm:inline-flex"
          >
            {t('browseAll')}
            <ArrowRight
              className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        </div>

        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => (
            <PublicJobCard key={job.id} job={job} locale={locale} />
          ))}
        </ul>

        {/*
          The fee line, placed HERE rather than only in the trust section
          further down.

          Overseas recruitment out of India has a well-earned fraud problem —
          unlicensed agents charging for placements that do not exist. "Never
          pay a fee" is the single objection standing between a candidate who
          likes a job and a candidate who registers, so it belongs at the point
          of decision, next to the Apply buttons, not on a page they may never
          scroll to.
        */}
        <p className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-success-bg px-4 py-3 text-center text-sm font-semibold text-success-fg">
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
          {t('noFee')}
        </p>

        <div className="mt-6 flex flex-col items-center gap-3">
          <Link
            href={`/${locale}/signup`}
            className={cn(buttonVariants({ variant: 'brand', size: 'lg' }), 'group font-bold')}
          >
            {t('ctaPrimary')}
            <ArrowRight
              className="size-5 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
          <Link
            href={`/${locale}/jobs`}
            className="rounded text-sm font-semibold text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            {t('browseAll')}
          </Link>
        </div>
      </div>
    </section>
  );
}
