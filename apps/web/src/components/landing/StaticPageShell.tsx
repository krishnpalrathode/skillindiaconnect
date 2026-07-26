import type { ReactNode } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { LandingHeader } from './LandingHeader';
import { LandingFooter } from './LandingFooter';

interface StaticPageShellProps {
  locale: string;
  title: string;
  lead: string;
  /** ISO date shown in the "Last updated" line. Omit for evergreen pages. */
  lastUpdated?: string;
  /** Shown above the content for pages still under legal review. */
  draftNotice?: boolean;
  children: ReactNode;
}

/**
 * Shared chrome for the public static pages (About / Contact / Privacy / Terms).
 * Reuses the landing header and footer so the whole public surface is one
 * consistent shell. Server component — no client JS beyond the header/footer
 * language switchers.
 */
export async function StaticPageShell({
  locale,
  title,
  lead,
  lastUpdated,
  draftNotice = false,
  children,
}: StaticPageShellProps) {
  const t = await getTranslations({ locale, namespace: 'staticPages.common' });

  return (
    <>
      <LandingHeader />

      <main id="main" className="bg-white">
        {/* Page header band */}
        <div className="border-b border-neutral-200 bg-neutral-50">
          <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
            <Link
              href={`/${locale}`}
              className="inline-flex min-h-[44px] items-center gap-2 rounded text-sm font-medium text-primary-700 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
              {t('backHome')}
            </Link>

            <h1 className="mt-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl">
              {title}
            </h1>
            <p className="mt-3 text-base leading-relaxed text-neutral-700">{lead}</p>

            {lastUpdated && (
              <p className="mt-4 text-sm font-medium text-neutral-600">
                {t('lastUpdated', { date: lastUpdated })}
              </p>
            )}
          </div>
        </div>

        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          {draftNotice && (
            <p
              role="note"
              className="mb-10 rounded-xl border border-warning-fg/25 bg-warning-bg px-5 py-4 text-sm font-medium text-warning-fg"
            >
              {t('draftNotice')}
            </p>
          )}
          {children}
        </div>
      </main>

      <LandingFooter />
    </>
  );
}
