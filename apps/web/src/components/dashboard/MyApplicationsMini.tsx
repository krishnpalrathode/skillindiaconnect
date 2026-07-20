'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonVariants } from '@/components/ui/button';
import { listMyApplications } from '@/lib/api/applications';
import { ApplicationCard } from '@/components/applications/ApplicationCard';
import { cn } from '@/lib/utils';

type ApplicationCardT = components['schemas']['ApplicationCard'];

const TOP_N = 3;

/**
 * Dashboard mini-table (S4-F2 live swap — replaced the "available once applications
 * open" placeholder). Shows the top-N most recent applications, each linking into
 * Screen 08, with a "View all" into the full list. Self-fetching so the dashboard
 * page's data flow is untouched.
 */
export function MyApplicationsMini() {
  const t = useTranslations('dashboard.myApplications');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  // null = loading, [] = loaded-empty (or failed → treated as empty, quiet).
  const [items, setItems] = useState<ApplicationCardT[] | null>(null);

  useEffect(() => {
    let active = true;
    listMyApplications({ limit: TOP_N })
      .then((res) => {
        if (active) setItems(res.data);
      })
      .catch(() => {
        if (active) setItems([]);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section aria-labelledby="my-applications-heading">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="my-applications-heading" className="text-lg font-bold text-neutral-900">
          {t('title')}
        </h2>
        {items && items.length > 0 && (
          <Link
            href={`/${locale}/applications`}
            className="rounded text-sm font-semibold text-[#0F3D91] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            {t('viewAll')}
          </Link>
        )}
      </div>

      {items === null ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-200/70 bg-white px-4 py-10 text-center shadow-sm">
          <span
            className="flex size-14 items-center justify-center rounded-full bg-[#E8F0FE] text-[#0F3D91]"
            aria-hidden="true"
          >
            <FileText className="size-6" />
          </span>
          <p className="text-sm text-neutral-600">{t('empty')}</p>
          <Link
            href={`/${locale}/jobs`}
            className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'min-h-11')}
          >
            {t('browseJobs')}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((a) => (
            <ApplicationCard key={a.id} application={a} locale={locale} />
          ))}
        </div>
      )}
    </section>
  );
}
