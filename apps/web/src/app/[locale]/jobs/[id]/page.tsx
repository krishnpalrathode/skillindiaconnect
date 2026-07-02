import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { JobDetail } from '@/components/jobs/JobDetail';
import { getJobServer } from '@/lib/api/jobs';
import { ServerApiError } from '@/lib/api/server-fetch';
import { formatSalaryRange } from '@/lib/jobs/format';

interface JobDetailPageProps {
  params: Promise<{ locale: string; id: string }>;
}

export async function generateMetadata({ params }: JobDetailPageProps): Promise<Metadata> {
  const { locale, id } = await params;
  try {
    const job = await getJobServer(id);
    const salary = formatSalaryRange(job.salaryMin, job.salaryMax, job.salaryCurrency, locale);
    return {
      title: `${job.title} at ${job.companyName}`,
      description: [job.location, salary, job.description?.slice(0, 120)]
        .filter(Boolean)
        .join(' · '),
      openGraph: {
        title: `${job.title} — ${job.companyName}`,
        description: job.location,
        type: 'article',
      },
    };
  } catch {
    // If the job doesn't exist, Next will hit notFound() in the page anyway —
    // return a minimal metadata object so generateMetadata doesn't also throw.
    const t = await getTranslations({ locale, namespace: 'jobs.detail' });
    return { title: t('notFoundTitle') };
  }
}

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { locale, id } = await params;

  let job;
  try {
    job = await getJobServer(id);
  } catch (err) {
    if (err instanceof ServerApiError && err.error.status === 404) {
      notFound();
    }
    throw err;
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <JobDetail job={job} locale={locale} />
    </main>
  );
}
