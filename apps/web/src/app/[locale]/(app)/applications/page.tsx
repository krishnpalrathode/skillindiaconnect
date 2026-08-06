'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FileText } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Button, buttonVariants } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Skeleton } from '@/components/ui/skeleton';
import { listMyApplications } from '@/lib/api/applications';
import { ApplicationCard } from '@/components/applications/ApplicationCard';
import { StatusFilterTabs, type StatusFilter } from '@/components/applications/StatusFilterTabs';
import { cn } from '@/lib/utils';
import { PAGE_SHELL } from '@/lib/page-shell';

type ApplicationCardT = components['schemas']['ApplicationCard'];

const VALID: StatusFilter[] = ['PENDING', 'SHORTLISTED', 'SELECTED', 'REJECTED'];
const PAGE_SIZE = 10;

export default function ApplicationsPage() {
  const t = useTranslations('applications');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const raw = searchParams.get('status');
  const status: StatusFilter =
    raw && (VALID as string[]).includes(raw) ? (raw as StatusFilter) : 'ALL';

  const [items, setItems] = useState<ApplicationCardT[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    setItems([]);
    setCursor(null);
    listMyApplications({ status: status === 'ALL' ? undefined : status, limit: PAGE_SIZE })
      .then((res) => {
        if (!active) return;
        setItems(res.data);
        setCursor(res.nextCursor);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await listMyApplications({
        status: status === 'ALL' ? undefined : status,
        cursor,
        limit: PAGE_SIZE,
      });
      setItems((prev) => [...prev, ...res.data]);
      setCursor(res.nextCursor);
    } catch {
      // Keep what we have; the load-more button stays for a retry.
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, status]);

  const onTab = (value: StatusFilter) => {
    const q = new URLSearchParams(searchParams.toString());
    if (value === 'ALL') q.delete('status');
    else q.set('status', value);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <main className={PAGE_SHELL}>
      <h1 className="text-xl font-bold text-neutral-900">{t('title')}</h1>

      <StatusFilterTabs value={status} onChange={onTab} />

      <div id="applications-list" role="tabpanel" className="flex flex-col gap-3">
        {loading ? (
          <>
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-neutral-600">{t('error')}</p>
            <Button variant="outline" onClick={() => router.refresh()} className="min-h-11">
              {t('retry')}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState status={status} locale={locale} />
        ) : (
          <>
            {items.map((a) => (
              <ApplicationCard key={a.id} application={a} locale={locale} />
            ))}
            {cursor && (
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={loadingMore}
                className="mx-auto mt-2 min-h-11"
              >
                {loadingMore ? <Spinner className="size-4" /> : null}
                {t('loadMore')}
              </Button>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function EmptyState({ status, locale }: { status: StatusFilter; locale: string }) {
  const t = useTranslations('applications');
  if (status === 'ALL') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <FileText className="size-10 text-neutral-300" aria-hidden="true" />
        <p className="text-sm text-neutral-600">{t('emptyAll')}</p>
        <Link
          href={`/${locale}/jobs`}
          className={cn(buttonVariants({ variant: 'primary' }), 'min-h-11')}
        >
          {t('browseJobs')}
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <FileText className="size-10 text-neutral-300" aria-hidden="true" />
      <p className="text-sm text-neutral-600">
        {t('emptyStatus', { status: t(`status.${status}`) })}
      </p>
    </div>
  );
}
