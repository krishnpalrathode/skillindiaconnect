'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { JOB_DESCRIPTION_MIN } from '@/lib/jobs/jobFormState';

const MAX_CHARS = 3000;

interface RichTextFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  className?: string;
}

export function RichTextField({ id, value, onChange, error, className }: RichTextFieldProps) {
  const t = useTranslations('jobform.description');
  const errorId = error ? `${id}-error` : undefined;
  const countId = `${id}-count`;
  const remaining = MAX_CHARS - value.length;
  /*
    Below the floor, the counter counts UP to the minimum instead of down from
    the ceiling. A writer 40 characters into a 300-character requirement is not
    helped by "2,960 left" — the number that matters to them is how much more
    they owe, and it is the same number the validation message will quote.
  */
  const typed = value.trim().length;
  const belowMinimum = typed < JOB_DESCRIPTION_MIN;
  const stillNeeded = JOB_DESCRIPTION_MIN - typed;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <textarea
        id={id}
        rows={8}
        value={value}
        onChange={(e) => {
          if (e.target.value.length <= MAX_CHARS) onChange(e.target.value);
        }}
        placeholder={t('placeholder')}
        aria-invalid={error ? true : undefined}
        aria-describedby={[errorId, countId].filter(Boolean).join(' ') || undefined}
        className={cn(
          'flex w-full rounded-md border bg-background px-3 py-2.5 text-sm outline-none resize-y',
          'focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-primary-600',
          'placeholder:text-neutral-600 ps-3 pe-3 min-h-[160px]',
          error ? 'border-error ring-[3px] ring-error/25' : 'border-input',
        )}
      />
      <div className="flex items-center justify-between">
        {error && (
          <p id={errorId} role="alert" className="text-xs text-error-fg font-medium">
            {error}
          </p>
        )}
        <p
          id={countId}
          className={cn(
            'ms-auto text-xs',
            belowMinimum || remaining < 100 ? 'text-warning-fg' : 'text-neutral-600',
          )}
          aria-live="polite"
          aria-atomic="true"
        >
          {belowMinimum
            ? t('charsToMinimum', { count: stillNeeded, min: JOB_DESCRIPTION_MIN })
            : `${remaining} ${t('charsLeft')}`}
        </p>
      </div>
    </div>
  );
}
