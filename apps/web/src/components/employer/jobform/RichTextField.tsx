'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

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
          'placeholder:text-neutral-400 ps-3 pe-3 min-h-[160px]',
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
            remaining < 100 ? 'text-warning-fg' : 'text-neutral-400',
          )}
          aria-live="polite"
          aria-atomic="true"
        >
          {remaining} {t('charsLeft')}
        </p>
      </div>
    </div>
  );
}
