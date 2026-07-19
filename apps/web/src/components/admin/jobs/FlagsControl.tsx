'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { setJobFlags, type AdminJobDetail } from '@/lib/api/admin-jobs';
import { PermissionGate } from '@/components/admin/PermissionGate';
import { cn } from '@/lib/utils';

/**
 * Featured / Urgent — ADMIN-SET ONLY (decision 3): an employer can never set
 * them on their own job, which is what keeps the badges meaningful. Real
 * switches (role="switch"), each named, with the effect explained in plain
 * words. The backend owns the search-cache invalidation; on success we hand
 * the returned row to the parent and it refetches — never optimistic.
 */
function FlagSwitch({
  id,
  label,
  checked,
  disabled,
  onToggle,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-3">
      <span id={`${id}-label`} className="text-sm font-medium text-neutral-800">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
          checked ? 'bg-primary-600' : 'bg-neutral-300',
          disabled && 'opacity-50',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
            checked ? 'start-[22px]' : 'start-0.5',
          )}
        />
      </button>
    </div>
  );
}

export function FlagsControl({ job, onChanged }: { job: AdminJobDetail; onChanged: () => void }) {
  const t = useTranslations('admin.jobs.flags');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle(flag: 'featured' | 'urgent') {
    setBusy(true);
    setFailed(false);
    try {
      await setJobFlags(job.id, {
        [flag]: flag === 'featured' ? !job.isFeatured : !job.isUrgent,
      });
      onChanged();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PermissionGate permission="jobs.moderate">
      <section
        aria-labelledby="flags-heading"
        className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4"
      >
        <h2 id="flags-heading" className="text-sm font-semibold text-neutral-900">
          {t('heading')}
        </h2>
        {/* What the flags actually DO — an unexplained toggle is a trap. */}
        <p className="text-xs text-neutral-600">{t('effect')}</p>

        <FlagSwitch
          id="flag-featured"
          label={t('featured')}
          checked={job.isFeatured}
          disabled={busy}
          onToggle={() => void toggle('featured')}
        />
        <FlagSwitch
          id="flag-urgent"
          label={t('urgent')}
          checked={job.isUrgent}
          disabled={busy}
          onToggle={() => void toggle('urgent')}
        />

        {failed && (
          <p role="alert" className="text-xs text-error-fg">
            {t('failed')}
          </p>
        )}
      </section>
    </PermissionGate>
  );
}
