import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BenefitChips } from './BenefitChips';
import { SaveJobButton } from './SaveJobButton';
import { formatPostedAgo, formatSalaryRange, isNewJob } from '@/lib/jobs/format';
import { Ltr } from '@/components/common/Ltr';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';
import type { JobCard as JobCardType } from '@/lib/api/jobs';

interface JobCardProps {
  job: JobCardType;
  locale: string;
}

// Server-renderable — only the embedded SaveJobButton is a Client Component.
// Title/company/View-Details are real <a> links so the card stays crawlable
// and works without JS; nothing employer-PII bearing is read off `job` here
// since JobCard (the API schema) never carries it.
//
// ── ONE card, two presentations (M3) ────────────────────────────────────────
// Phone styling is the BASE and every desktop value is restored at `sm:`, which
// is the same breakpoint the list grid uses to go multi-column
// (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`). So "phone" here means exactly
// "the width at which a card is the full row". There is no mobile fork and no
// second component: the same tree renders everywhere, and above `sm` it renders
// the values it rendered before this unit.
//
// ── No thumbnail, deliberately ──────────────────────────────────────────────
// The mockup shows a photo on every card. `JobCard` — the public search shape —
// carries no image of any kind, and `Company.logoKey` exists but reaching it
// would mean widening the DTO, which this unit does not do. The alternative,
// stock photography, is the one option worth refusing outright: a worker
// choosing where to apply must not be shown a workplace that is not the job.
// So the card is built to look intentional without one, which is also what it
// has to do for every employer that never uploads a logo.
export function JobCard({ job, locale }: JobCardProps) {
  const t = useTranslations('jobs.card');
  const href = `/${locale}/jobs/${job.id}`;
  const salary = formatSalaryRange(job.salaryMin, job.salaryMax, job.salaryCurrency, locale);

  // The card's accessible name is "<title>, <company>" — built by pointing at
  // the two elements that already carry that text rather than duplicating it
  // into an aria-label that could drift out of sync with what is rendered.
  const titleId = `job-${job.id}-title`;
  const companyId = `job-${job.id}-company`;

  /*
    role="article" + aria-labelledby goes on the Card itself rather than an
    <article> nested inside it: Card renders a styled div and spreads props onto
    it, so this makes the CARD the landmark instead of wrapping one in another.
    Each result becomes something a screen-reader user can jump between, named
    "<title>, <company>", instead of an anonymous div in a list of forty.
  */
  return (
    <Card
      role="article"
      aria-labelledby={`${titleId} ${companyId}`}
      className="h-full rounded-2xl sm:rounded-lg"
    >
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={job.market === 'GULF' ? 'primary' : 'accent'}>
            {t(job.market === 'GULF' ? 'marketGulf' : 'marketLocal')}
          </Badge>
          {isNewJob(job.createdAt) && <Badge variant="info">{t('newBadge')}</Badge>}
        </div>
        <SaveJobButton jobId={job.id} initialSaved={job.isSaved ?? null} variant="icon" />
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-2">
        <div>
          {/*
              `break-words` on both: company names in this market run long
              ("Al Rashid International Manpower Consultancy Pvt. Ltd."), and a
              single unbroken token would otherwise push the card wider than the
              360px viewport and scroll the whole page sideways.
            */}
          <h3
            id={titleId}
            className="break-words text-lg font-semibold leading-snug text-neutral-900 sm:text-base"
          >
            <Link
              href={href}
              className="rounded hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              {job.title}
            </Link>
          </h3>
          <p id={companyId} className="break-words text-sm text-neutral-600">
            {job.companyName}
          </p>
        </div>

        <p className="flex items-start gap-1 text-sm text-neutral-600">
          <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="break-words">{job.location}</span>
        </p>

        {/*
            RTL-001: bidi-isolated so the range bounds cannot swap in Arabic.
            Larger on a phone because it is the number the reader is scanning
            for; `sm:` puts it back to the desktop weight and size.

            Absent entirely when the job has no salary — `formatSalaryRange`
            returns null for that, and for a min-only or max-only job it
            returns the single figure rather than a half-empty range.
          */}
        {salary && (
          <p className="text-lg font-bold text-neutral-900 sm:text-sm sm:font-medium">
            <Ltr>{salary}</Ltr>
          </p>
        )}

        {/*
            The market-driven benefit chips, immediately under the salary.

            They are not decoration and they are not negotiable in a restyle:
            for Gulf work, accommodation and food are routinely worth more than
            a salary difference, and they are the platform's worker-protection
            guarantee made visible. They sit here — above posted-ago, below the
            money — so that they are on screen at the same moment the salary is.
          */}
        <BenefitChips job={job} />

        <p className="mt-auto pt-1 text-xs text-neutral-600">
          {formatPostedAgo(job.createdAt, locale)}
        </p>
      </CardContent>

      <CardFooter>
        {/*
            Apply is a LINK to the job, phone-only.

            It is not a second apply entry point and could not be: the real
            control is `ApplyButton` on the detail page, which takes a
            `JobDetail` and decides between login-redirect, the apply sheet, the
            eligibility preview and "Applied ✓". None of that state exists on a
            search-result card, so a button here could only guess — and guessing
            "Apply" at someone whose profile is incomplete is how a candidate
            gets bounced. It carries them to the one place that knows.

            `sm:hidden` keeps the desktop footer exactly as it was: a single
            "View details" link.
          */}
        <Link
          href={href}
          aria-label={t('applyToJob', { title: job.title })}
          className={cn(
            buttonVariants({ variant: 'brand', size: 'sm' }),
            'min-h-11 flex-1 font-bold sm:hidden',
          )}
        >
          {t('apply')}
        </Link>
        <Link
          href={href}
          className="inline-flex min-h-11 shrink-0 items-center rounded px-2 text-sm font-medium text-primary-600 hover:text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 sm:min-h-0 sm:px-0"
        >
          {t('viewDetails')}
        </Link>
      </CardFooter>
    </Card>
  );
}
