'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type CompletionResult = components['schemas']['CompletionResult'];

interface EligibilityPreviewProps {
  completion: CompletionResult;
  locale: string;
  onRecheck: () => void;
  rechecking: boolean;
}

/**
 * Guidance BEFORE submit — renders `missingForApply` (the frozen contract's
 * human-readable blockers) as an actionable checklist with a fix link per item.
 * The destination is derived from the item text (documents/passport →
 * /profile#documents, otherwise → /profile). This is UX only: the copy never
 * promises the server will agree — the real decision happens on submit.
 */
export function EligibilityPreview({
  completion,
  locale,
  onRecheck,
  rechecking,
}: EligibilityPreviewProps) {
  const t = useTranslations('apply.eligibility');
  const items = completion.missingForApply ?? [];
  const allClear = items.length === 0;

  const fixHref = (item: string): string => {
    const isDocs = /passport|document/i.test(item);
    return `/${locale}/profile${isDocs ? '#documents' : ''}`;
  };

  return (
    <div className="flex flex-col gap-4" role="group" aria-label={t('title')}>
      <div>
        <h3 className="text-base font-semibold text-neutral-900">{t('title')}</h3>
        <p className="mt-0.5 text-sm text-neutral-600">{t('pct', { pct: completion.pct })}</p>
      </div>

      {allClear ? (
        <div className="flex items-start gap-2 rounded-lg bg-success-bg p-3 text-sm text-success-fg">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>{t('allClear')}</span>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 p-3"
            >
              <span className="flex items-start gap-2 text-sm text-neutral-800">
                <AlertCircle
                  className="mt-0.5 size-5 shrink-0 text-warning-fg"
                  aria-hidden="true"
                />
                {item}
              </span>
              <Link
                href={fixHref(item)}
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'shrink-0 min-h-11',
                )}
              >
                {t('fix')}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Button
        variant="outline"
        onClick={onRecheck}
        disabled={rechecking}
        className="w-fit min-h-11"
      >
        <RefreshCw className={cn('size-4', rechecking && 'animate-spin')} aria-hidden="true" />
        {t('recheck')}
      </Button>
    </div>
  );
}
