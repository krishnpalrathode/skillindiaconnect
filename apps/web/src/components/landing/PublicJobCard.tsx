import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MapPin, Building2, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { BenefitChips } from '@/components/jobs/BenefitChips';
import { Ltr } from '@/components/common/Ltr';
import { formatPostedAgo, formatSalaryRange, isNewJob } from '@/lib/jobs/format';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';
import type { JobCard as JobCardType } from '@/lib/api/jobs';

interface PublicJobCardProps {
  job: JobCardType;
  locale: string;
}

/**
 * A job as an ANONYMOUS visitor sees it on the landing page.
 *
 * Deliberately not `components/jobs/JobCard` — that one embeds SaveJobButton,
 * which is a client component that calls an authenticated endpoint. On a page
 * whose entire audience is logged out, every card would ship JS for a control
 * that can only fail. This card is pure server-rendered HTML.
 *
 * The ordering is a conversion decision, not a layout one. For Gulf blue-collar
 * hiring the salary is what the reader is scanning for, so it sits above the
 * fold of the card in the largest type; the benefit chips come next because
 * free accommodation and food are routinely worth more than a salary
 * difference, and are what distinguishes a real overseas offer from a bad one.
 * Company and location follow. Posted-ago is last but present, because a board
 * with no dates on it reads as a board with no jobs on it.
 *
 * Everything is a real `<a>`: the card must work with no JS and must be
 * crawlable, since indexed job titles are the cheapest candidate acquisition
 * this product has.
 */
export function PublicJobCard({ job, locale }: PublicJobCardProps) {
  const t = useTranslations('landing.recentJobs');
  const tCard = useTranslations('jobs.card');

  const href = `/${locale}/jobs/${job.id}`;
  const salary = formatSalaryRange(job.salaryMin, job.salaryMax, job.salaryCurrency, locale);

  /*
    Apply sends a logged-out visitor to sign-in, carrying `next` so they come
    BACK to this job afterwards.

    The `next` is the whole point. Dropping it is the classic funnel leak on job
    boards: the candidate taps Apply on a specific job, authenticates, lands on
    a generic dashboard, and now has to find the job again from memory. Most
    don't. The login screen already reads `?next=`, so preserving intent here
    costs one query parameter.
  */
  const applyHref = `/${locale}/login?next=${encodeURIComponent(href)}`;

  return (
    <li className="flex h-full flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={job.market === 'GULF' ? 'primary' : 'accent'}>
          {tCard(job.market === 'GULF' ? 'marketGulf' : 'marketLocal')}
        </Badge>
        {isNewJob(job.createdAt) && <Badge variant="info">{tCard('newBadge')}</Badge>}
      </div>

      <h3 className="text-base font-bold leading-snug text-neutral-900">
        <Link
          href={href}
          className="rounded hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          {job.title}
        </Link>
      </h3>

      {/* The number they came for. Bidi-isolated so the range bounds cannot
          swap around in Arabic or Urdu. */}
      {salary && (
        <p className="text-lg font-bold text-primary-700">
          <Ltr>{salary}</Ltr>
        </p>
      )}

      <BenefitChips job={job} />

      <div className="flex flex-col gap-1 text-sm text-neutral-600">
        <p className="flex items-center gap-1.5">
          <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
          {job.companyName}
        </p>
        <p className="flex items-center gap-1.5">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          {job.country ? `${job.location}, ${job.country}` : job.location}
        </p>
      </div>

      <p className="mt-auto pt-1 text-xs text-neutral-600">
        {formatPostedAgo(job.createdAt, locale)}
      </p>

      <div className="flex items-center gap-3 border-t border-neutral-100 pt-3">
        <Link
          href={applyHref}
          className={cn(buttonVariants({ variant: 'brand', size: 'sm' }), 'group flex-1 font-bold')}
        >
          {t('apply')}
          <ArrowRight
            className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
            aria-hidden="true"
          />
        </Link>
        {/*
          "View details" stays UNGATED and sits beside Apply on purpose.

          Gating the listing itself is the obvious move and the wrong one: it
          costs the search-engine indexing that brings strangers here, and it
          asks someone to create an account before they have any reason to
          trust us. Let them read the whole job; ask for the account at the
          moment they decide they want it.
        */}
        <Link
          href={href}
          className="shrink-0 rounded px-2 text-sm font-semibold text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          {tCard('viewDetails')}
        </Link>
      </div>
    </li>
  );
}
