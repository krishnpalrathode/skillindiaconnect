import { useTranslations } from 'next-intl';
import { JobCard } from './JobCard';
import type { JobCard as JobCardType } from '@/lib/api/jobs';

interface SimilarJobsProps {
  jobs: JobCardType[];
  locale: string;
}

export function SimilarJobs({ jobs, locale }: SimilarJobsProps) {
  const t = useTranslations('jobs.detail');

  if (jobs.length === 0) return null;

  return (
    <section aria-labelledby="similar-jobs-heading" className="flex flex-col gap-3">
      <h2 id="similar-jobs-heading" className="text-base font-semibold text-neutral-900">
        {t('similarJobs')}
      </h2>
      <ul className="flex flex-col gap-3">
        {jobs.map((job) => (
          <li key={job.id}>
            <JobCard job={job} locale={locale} />
          </li>
        ))}
      </ul>
    </section>
  );
}
