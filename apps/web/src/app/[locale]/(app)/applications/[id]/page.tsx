'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, MapPin } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { getMyApplication } from '@/lib/api/applications';
import { ApiRequestError } from '@/lib/api/client';
import { STATUS_VARIANT } from '@/components/applications/ApplicationCard';
import { WhatsAppReceipt } from '@/components/applications/WhatsAppReceipt';
import { ApplicationTimeline } from '@/components/applications/ApplicationTimeline';
import { RejectionCard } from '@/components/applications/RejectionCard';
import { PAGE_SHELL } from '@/lib/page-shell';

type ApplicationDetail = components['schemas']['ApplicationDetail'];

export default function ApplicationDetailPage() {
  const t = useTranslations('applications');
  const tCard = useTranslations('jobs.card');
  const params = useParams<{ locale: string; id: string }>();
  const locale = params.locale ?? 'en';
  const id = params.id;

  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    setState('loading');
    getMyApplication(id)
      .then((a) => {
        if (!active) return;
        setApp(a);
        setState('ready');
      })
      .catch((err: unknown) => {
        if (!active) return;
        setState(err instanceof ApiRequestError && err.error.status === 404 ? 'notfound' : 'error');
      });
    return () => {
      active = false;
    };
  }, [id]);

  const backLink = (
    <Link
      href={`/${locale}/applications`}
      className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
    >
      <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
      {t('backToList')}
    </Link>
  );

  return (
    <main className={PAGE_SHELL}>
      {backLink}

      {state === 'loading' && (
        <>
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </>
      )}

      {state === 'notfound' && (
        <p className="py-16 text-center text-sm text-neutral-600">{t('notFound')}</p>
      )}

      {state === 'error' && (
        <p className="py-16 text-center text-sm text-neutral-600">{t('error')}</p>
      )}

      {state === 'ready' && app && (
        <>
          {/* Header */}
          <section className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={app.job.market === 'GULF' ? 'primary' : 'accent'}>
                  {tCard(app.job.market === 'GULF' ? 'marketGulf' : 'marketLocal')}
                </Badge>
                <Badge variant={STATUS_VARIANT[app.status]}>{t(`status.${app.status}`)}</Badge>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-700">
                {t('matchShort', { score: app.matchScore })}
              </span>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-neutral-900">{app.job.title}</h1>
              <p className="text-sm text-neutral-600">{app.job.companyName}</p>
              <p className="mt-1 flex items-center gap-1 text-sm text-neutral-600">
                <MapPin className="size-4 shrink-0" aria-hidden="true" />
                {app.job.location}
              </p>
            </div>
            <p className="text-xs font-medium text-neutral-600">{app.humanId}</p>
            {app.selectedNotifiedAt && (
              <WhatsAppReceipt notifiedAt={app.selectedNotifiedAt} locale={locale} />
            )}
          </section>

          {/* Timeline */}
          <section className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4">
            <h2 className="text-base font-semibold text-neutral-900">{t('timeline.heading')}</h2>
            <ApplicationTimeline
              timeline={app.timeline}
              appliedAt={app.appliedAt}
              locale={locale}
            />
          </section>

          {/* Rejected → constructive next-step (+ feedback when present) */}
          {app.status === 'REJECTED' && (
            <RejectionCard feedback={app.rejectionFeedback} locale={locale} />
          )}

          {/* Cover letter (candidate's own submission, if any) */}
          {app.coverLetter && (
            <section className="rounded-xl border border-neutral-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-neutral-900">{t('coverLetter')}</h2>
              <p className="mt-1 whitespace-pre-line text-sm text-neutral-700">{app.coverLetter}</p>
            </section>
          )}
        </>
      )}
    </main>
  );
}
