'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lightbulb, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const SESSION_KEY = 'employer-nudge-dismissed';

interface ChecklistNudgeProps {
  hint: string | null;
  className?: string;
}

/**
 * Profile-completeness nudge card.
 *
 * Renders the computed `hint` string when non-null (e.g., "Upload a company logo").
 * Dismissible per browser session (sessionStorage). Reappears on a fresh session
 * while the profile is still incomplete (hint !== null).
 *
 * Spec decision: displays the HINT text directly — no percentage anywhere.
 */
export function ChecklistNudge({ hint, className }: ChecklistNudgeProps) {
  const t = useTranslations('employer.profile.nudge');
  const [dismissed, setDismissed] = useState(false);

  // Read dismissal state from sessionStorage on mount (avoids hydration mismatch)
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && sessionStorage.getItem(SESSION_KEY) === '1') {
        setDismissed(true);
      }
    } catch {
      // sessionStorage unavailable (private browsing in some browsers)
    }
  }, []);

  if (!hint || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // silently ignore
    }
  };

  return (
    <div
      role="note"
      aria-label={t('title')}
      className={cn(
        'flex items-start gap-3 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3',
        className,
      )}
    >
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary-600" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-primary-900">{t('title')}</p>
        <p className="text-sm text-primary-700 mt-0.5">{hint}</p>
      </div>
      <button
        type="button"
        aria-label={t('dismiss')}
        onClick={handleDismiss}
        className={cn(
          'shrink-0 rounded-md p-0.5 text-primary-500 hover:text-primary-700',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
        )}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
