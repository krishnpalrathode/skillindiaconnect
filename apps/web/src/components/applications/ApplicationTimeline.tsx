'use client';

import { useTranslations } from 'next-intl';
import type { components } from '@skillindiaconnect/shared-types';
import { cn } from '@/lib/utils';

type ApplicationTimelineEntry = components['schemas']['ApplicationTimelineEntry'];

interface ApplicationTimelineProps {
  timeline: ApplicationTimelineEntry[];
  /** The application's appliedAt — anchors the synthetic "Applied" step at the top. */
  appliedAt: string;
  locale: string;
}

interface Step {
  key: string;
  label: string;
  date: string;
  isAdminOverride: boolean;
}

/**
 * Renders ONLY the shaped timeline subset. The "Applied" event is synthesized from
 * `appliedAt` (the contract's timeline carries transitions only, with non-null
 * fromStatus — there is no null→PENDING creation row). Admin overrides render a
 * NEUTRAL, role-level line — never a reason, an actor identity, or an empty
 * "Reason:" slot (the data excludes it; the copy must not editorialize).
 *
 * Vertical connector + start-aligned labels mirror under RTL automatically (flex
 * row: the marker column is the inline-start item; the connector is vertical).
 */
export function ApplicationTimeline({ timeline, appliedAt, locale }: ApplicationTimelineProps) {
  const t = useTranslations('applications.timeline');

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

  const steps: Step[] = [
    { key: 'applied', label: t('applied'), date: fmt(appliedAt), isAdminOverride: false },
    ...timeline.map(
      (e, i): Step => ({
        key: `t-${i}`,
        label: e.isAdminOverride ? t('adminOverride') : t(e.toStatus),
        date: fmt(e.createdAt),
        isAdminOverride: e.isAdminOverride,
      }),
    ),
  ];

  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={s.key} className="flex gap-3">
            <div className="flex flex-col items-center" aria-hidden="true">
              <span
                className={cn(
                  'mt-1 size-2.5 shrink-0 rounded-full',
                  s.isAdminOverride ? 'bg-accent-500 ring-2 ring-accent-200' : 'bg-primary-500',
                )}
              />
              {!last && <span className="w-px flex-1 bg-neutral-200" />}
            </div>
            <div className={cn('pb-5', last && 'pb-0')}>
              <p className="text-sm font-medium text-neutral-800">{s.label}</p>
              <p className="text-xs text-neutral-500">{s.date}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
