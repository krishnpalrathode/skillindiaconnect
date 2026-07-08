'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface RejectionCardProps {
  /** rejectionFeedback — when present, quoted plainly; when absent, NO block at all. */
  feedback?: string | null;
  locale: string;
}

/**
 * Shown on a REJECTED detail. Constructive framing for an audience that takes
 * rejection hard — no wall of red. The employer feedback renders ONLY when
 * present (S3 absence-discipline: no "no reason given" placeholder). The
 * next-step is the PLAIN browse-jobs variant (the detail exposes no reliable
 * per-trade count, so we don't fabricate "{n}+ jobs").
 */
export function RejectionCard({ feedback, locale }: RejectionCardProps) {
  const t = useTranslations('applications.rejection');

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      {feedback && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {t('feedbackLabel')}
          </p>
          <p className="mt-1 text-sm text-neutral-700">&ldquo;{feedback}&rdquo;</p>
        </div>
      )}
      <div>
        <p className="text-sm font-medium text-neutral-800">{t('nextStepTitle')}</p>
        <p className="mt-0.5 text-sm text-neutral-500">{t('nextStepBody')}</p>
        <Link
          href={`/${locale}/jobs`}
          className={cn(buttonVariants({ variant: 'outline' }), 'mt-3 min-h-11')}
        >
          {t('browseJobs')}
        </Link>
      </div>
    </div>
  );
}
