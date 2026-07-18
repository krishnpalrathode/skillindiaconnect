'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, ArrowRight, X } from 'lucide-react';

const DISMISS_KEY = 'employer-nudge-dismissed';

interface ChecklistCardProps {
  /** profileChecklist.hint — the next actionable item, or null when complete. */
  hint: string | null;
}

/**
 * Dashboard profile-completeness nudge (Screen 15, S3).
 *
 * Renders the server-computed `profileChecklist.hint` (never a percentage) and
 * links to the Company Profile screen (S3-F1) to act on it. Session-dismissible,
 * sharing the same sessionStorage key as F1's profile-page nudge so a single
 * dismissal quiets the nudge everywhere for the session.
 */
export function ChecklistCard({ hint }: ChecklistCardProps) {
  const t = useTranslations('employer.dashboard.checklist');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  if (!hint || dismissed) return null;

  return (
    <section
      role="note"
      aria-label={t('title')}
      className="relative flex items-start gap-3 rounded-xl border border-primary-200 bg-primary-50/60 p-4 pe-10"
    >
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-600">
        <Sparkles className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-neutral-900">{t('title')}</p>
        <p className="mt-0.5 text-sm text-neutral-600">{hint}</p>
        <Link
          href={`/${locale}/employer/profile`}
          className="mt-2 inline-flex items-center gap-1 rounded text-sm font-medium text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          {t('cta')}
          <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('dismiss')}
        className="absolute end-2 top-2 flex size-8 items-center justify-center rounded-md text-neutral-400 hover:bg-primary-100 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </section>
  );
}
