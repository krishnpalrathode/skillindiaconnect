import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BenefitChips } from './BenefitChips';
import { SaveJobButton } from './SaveJobButton';
import { formatPostedAgo, formatSalaryRange, isNewJob } from '@/lib/jobs/format';
import type { JobCard as JobCardType } from '@/lib/api/jobs';

interface JobCardProps {
  job: JobCardType;
  locale: string;
}

// Server-renderable — only the embedded SaveJobButton is a Client Component.
// Title/company/View-Details are real <a> links so the card stays crawlable
// and works without JS; nothing employer-PII bearing is read off `job` here
// since JobCard (the API schema) never carries it.
export function JobCard({ job, locale }: JobCardProps) {
  const t = useTranslations('jobs.card');
  const href = `/${locale}/jobs/${job.id}`;
  const salary = formatSalaryRange(job.salaryMin, job.salaryMax, job.salaryCurrency, locale);

  return (
    <Card className="h-full">
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
          <h3 className="text-base font-semibold leading-snug text-neutral-900">
            <Link
              href={href}
              className="hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
            >
              {job.title}
            </Link>
          </h3>
          <p className="text-sm text-neutral-600">{job.companyName}</p>
        </div>

        <p className="flex items-center gap-1 text-sm text-neutral-500">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          {job.location}
        </p>

        {salary && <p className="text-sm font-medium text-neutral-900">{salary}</p>}

        <BenefitChips job={job} />

        <p className="mt-auto text-xs text-neutral-400">{formatPostedAgo(job.createdAt, locale)}</p>
      </CardContent>

      <CardFooter>
        <Link
          href={href}
          className="text-sm font-medium text-primary-600 hover:text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {t('viewDetails')}
        </Link>
      </CardFooter>
    </Card>
  );
}
