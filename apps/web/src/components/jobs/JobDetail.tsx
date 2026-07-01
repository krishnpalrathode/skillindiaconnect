'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { MapPin, Users, Briefcase } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { BenefitChips } from './BenefitChips';
import { SaveJobButton } from './SaveJobButton';
import { SimilarJobs } from './SimilarJobs';
import { formatPostedAgo, formatSalaryRange, isNewJob } from '@/lib/jobs/format';
import { useAuth } from '@/lib/auth/auth-context';
import { cn } from '@/lib/utils';
import type { JobDetail as JobDetailType } from '@/lib/api/jobs';

interface JobDetailProps {
  job: JobDetailType;
  locale: string;
}

// 'use client' only because the profile-completion nudge below reads
// useAuth(); Next.js still server-renders this component's full markup into
// the initial HTML response (client components are SSR'd too — "use client"
// only means "also hydrate in the browser"), so this doesn't affect SEO or
// the SSR requirement for this screen.
export function JobDetail({ job, locale }: JobDetailProps) {
  const t = useTranslations('jobs.detail');
  const tCard = useTranslations('jobs.card');
  const { user } = useAuth();

  const salary = formatSalaryRange(job.salaryMin, job.salaryMax, job.salaryCurrency, locale);
  const requirements = job.requirements ?? [];
  const similarJobs = job.similarJobs ?? [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader className="flex-col items-start gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={job.market === 'GULF' ? 'primary' : 'accent'}>
                {tCard(job.market === 'GULF' ? 'marketGulf' : 'marketLocal')}
              </Badge>
              {isNewJob(job.createdAt) && <Badge variant="info">{tCard('newBadge')}</Badge>}
            </div>

            <div>
              <h1 className="text-xl font-semibold text-neutral-900 sm:text-2xl">{job.title}</h1>
              <p className="text-base text-neutral-600">{job.companyName}</p>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-500">
              <span className="flex items-center gap-1">
                <MapPin className="size-4 shrink-0" aria-hidden="true" />
                {job.location}
              </span>
              <span>{formatPostedAgo(job.createdAt, locale)}</span>
            </div>

            {salary && <p className="text-lg font-semibold text-neutral-900">{salary}</p>}

            <BenefitChips job={job} />

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {/*
                Apply Now is a placeholder link to the (not-yet-built) S4
                application flow — out of scope for this screen. It is left
                as a real link rather than a disabled button so the affordance
                is visible and testable once S4 ships.
              */}
              <Link
                href={`/${locale}/jobs/${job.id}/apply`}
                className={cn(buttonVariants({ variant: 'primary' }))}
              >
                {t('applyNow')}
              </Link>
              <SaveJobButton jobId={job.id} initialSaved={job.isSaved ?? null} variant="full" />
            </div>
          </CardHeader>
        </Card>

        {user?.role === 'CANDIDATE' && (
          <Card className="border-info bg-info-bg">
            <CardContent className="text-sm text-info-fg">{t('profileNudge')}</CardContent>
          </Card>
        )}

        {job.description && (
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-neutral-900">{t('description')}</h2>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-line text-sm text-neutral-700">{job.description}</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-neutral-900">{t('jobDetails')}</h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {job.experienceRequiredYears != null && (
                <div className="flex items-center gap-2 text-sm">
                  <Briefcase className="size-4 shrink-0 text-neutral-400" aria-hidden="true" />
                  <dt className="text-neutral-500">{t('experience')}</dt>
                  <dd className="font-medium text-neutral-900">
                    {t('experienceYears', { count: job.experienceRequiredYears })}
                  </dd>
                </div>
              )}
              {job.vacancies != null && (
                <div className="flex items-center gap-2 text-sm">
                  <Users className="size-4 shrink-0 text-neutral-400" aria-hidden="true" />
                  <dt className="text-neutral-500">{t('vacancies')}</dt>
                  <dd className="font-medium text-neutral-900">{job.vacancies}</dd>
                </div>
              )}
              {job.genderPreference && job.genderPreference !== 'ANY' && (
                <div className="flex items-center gap-2 text-sm">
                  <dt className="text-neutral-500">{t('genderPreference')}</dt>
                  <dd className="font-medium text-neutral-900">
                    {t(`gender.${job.genderPreference}`)}
                  </dd>
                </div>
              )}
            </dl>

            {/*
              The schema has no discrete job-type/hours/overtime/contract
              fields — only this single freeform `workConditions` string —
              so those details are collapsed into one block rather than
              fabricated structure the API doesn't provide.
            */}
            {job.workConditions && (
              <div>
                <h3 className="mb-1 text-sm font-semibold text-neutral-700">
                  {t('workConditions')}
                </h3>
                <p className="whitespace-pre-line text-sm text-neutral-700">{job.workConditions}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {requirements.length > 0 && (
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-neutral-900">{t('requirements')}</h2>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2">
                {requirements.map((req, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-neutral-700">
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary-600"
                      aria-hidden="true"
                    />
                    {req}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-neutral-900">{t('aboutCompany')}</h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {/*
              JobDetail only carries `companyName` (a plain string) — there is
              no nested company object on the public job schema, so this card
              cannot show a logo, description, or a Verified badge. The link
              below is a placeholder for a future company-profile screen.
            */}
            <p className="text-sm text-neutral-700">{job.companyName}</p>
            <Link
              href={`/${locale}/jobs?market=${job.market}`}
              className="text-sm font-medium text-primary-600 hover:text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded w-fit"
            >
              {t('viewCompanyProfile')}
            </Link>
          </CardContent>
        </Card>
      </div>

      <aside>
        <SimilarJobs jobs={similarJobs} locale={locale} />
      </aside>
    </div>
  );
}
