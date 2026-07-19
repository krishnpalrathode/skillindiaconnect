'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import { DEFAULT_WINDOW_DAYS, LOG_MODULES, LOG_STATUSES } from '@/lib/api/admin-logs';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface LogFilterValues {
  module: string;
  status: string;
  actorId: string;
  targetId: string;
  q: string;
  from: string;
  to: string;
}

export const EMPTY_FILTERS: LogFilterValues = {
  module: '',
  status: '',
  actorId: '',
  targetId: '',
  q: '',
  from: '',
  to: '',
};

/**
 * Screen 29's real function is FINDING, not browsing — an admin arrives with a
 * question ("who blocked this publish?", "what did this actor touch?"), so the
 * filters are the primary surface, not an afterthought.
 *
 * Module chips are SINGLE-select: the API's `module` parameter takes one value
 * (B1's whitelisted equality filter), and a multi-select UI over a single-value
 * parameter would silently drop selections.
 *
 * Text filters apply on SUBMIT (one request per investigation step, not per
 * keystroke); chips apply immediately (they're one click each).
 *
 * THE DEFAULT-WINDOW DISCLOSURE: with no date range the SERVER returns only the
 * last 30 days (a deliberate B1 bound — the only createdAt index is BRIN). The
 * banner below says so, because without it an admin searching for a March event
 * in July concludes the logs were deleted.
 */
export function LogFilters({
  values,
  onChange,
}: {
  values: LogFilterValues;
  onChange: (next: LogFilterValues) => void;
}) {
  const t = useTranslations('admin.logs');
  const [draft, setDraft] = useState(values);

  // Chips + selects commit immediately; text/date inputs stage into the draft
  // and commit on submit.
  function commitNow(patch: Partial<LogFilterValues>) {
    const next = { ...values, ...draft, ...patch };
    setDraft(next);
    onChange(next);
  }

  const noDateRange = !values.from && !values.to;

  return (
    <div className="flex flex-col gap-3">
      {/* Module chips */}
      <div role="group" aria-label={t('moduleFilterLabel')} className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-pressed={values.module === ''}
          onClick={() => commitNow({ module: '' })}
          className={cn(
            'min-h-[44px] rounded-full px-3 text-sm font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
            values.module === ''
              ? 'bg-primary-600 text-white'
              : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200',
          )}
        >
          {t('allModules')}
        </button>
        {LOG_MODULES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={values.module === m}
            onClick={() => commitNow({ module: values.module === m ? '' : m })}
            className={cn(
              'min-h-[44px] rounded-full px-3 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
              values.module === m
                ? 'bg-primary-600 text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200',
            )}
          >
            {t(`modules.${m}`)}
          </button>
        ))}
      </div>

      {/* Structured filters */}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onChange(draft);
        }}
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
          {t('statusLabel')}
          <select
            value={values.status}
            onChange={(e) => commitNow({ status: e.target.value })}
            className="min-h-[44px] rounded-lg border border-neutral-300 px-2 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <option value="">{t('anyStatus')}</option>
            {LOG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
          {t('actorLabel')}
          <input
            value={draft.actorId}
            onChange={(e) => setDraft({ ...draft, actorId: e.target.value })}
            placeholder={t('actorPlaceholder')}
            className="min-h-[44px] w-56 rounded-lg border border-neutral-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
          {t('targetLabel')}
          <input
            value={draft.targetId}
            onChange={(e) => setDraft({ ...draft, targetId: e.target.value })}
            placeholder={t('targetPlaceholder')}
            className="min-h-[44px] w-44 rounded-lg border border-neutral-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
          {t('searchLabel')}
          <input
            value={draft.q}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            placeholder={t('searchPlaceholder')}
            className="min-h-[44px] w-48 rounded-lg border border-neutral-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
          {t('fromLabel')}
          <input
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            className="min-h-[44px] rounded-lg border border-neutral-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
          {t('toLabel')}
          <input
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            className="min-h-[44px] rounded-lg border border-neutral-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          />
        </label>

        <Button type="submit" variant="outline" size="sm">
          {t('applyFilters')}
        </Button>
      </form>

      {/* The default-window disclosure — prevents "where are my old logs?" */}
      {noDateRange && (
        <p role="note" className="flex items-center gap-1.5 text-xs text-neutral-600">
          <Info className="size-3.5 shrink-0" aria-hidden="true" />
          {t('defaultWindowNote', { days: DEFAULT_WINDOW_DAYS })}
        </p>
      )}
    </div>
  );
}
