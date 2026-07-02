'use client';

import React, { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, X, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

const MAX_ITEMS = 20;

interface RequirementsFieldProps {
  value: string[];
  onChange: (items: string[]) => void;
  error?: string;
  className?: string;
}

export function RequirementsField({ value, onChange, error, className }: RequirementsFieldProps) {
  const t = useTranslations('jobform.requirements');
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = 'requirements-list';
  const errorId = error ? 'requirements-error' : undefined;

  const addItem = () => {
    const trimmed = draft.trim();
    if (!trimmed || value.length >= MAX_ITEMS) return;
    onChange([...value, trimmed]);
    setDraft('');
    inputRef.current?.focus();
  };

  const removeItem = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem();
    }
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Existing items */}
      {value.length > 0 && (
        <ol id={listId} aria-label={t('listLabel')} className="flex flex-col gap-1.5">
          {value.map((item, idx) => (
            <li
              key={idx}
              className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm"
            >
              <GripVertical className="size-4 shrink-0 text-neutral-300" aria-hidden="true" />
              <span className="flex-1 min-w-0 text-neutral-800">{item}</span>
              <button
                type="button"
                onClick={() => removeItem(idx)}
                aria-label={t('removeAriaLabel', { item })}
                className="shrink-0 rounded p-0.5 text-neutral-400 hover:text-error-fg hover:bg-error-bg/30 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      )}

      {/* Empty state */}
      {value.length === 0 && <p className="text-sm text-neutral-400 italic">{t('emptyHint')}</p>}

      {/* Add new item */}
      {value.length < MAX_ITEMS && (
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('addPlaceholder')}
            aria-label={t('addAriaLabel')}
            aria-describedby={errorId}
            maxLength={200}
            className={cn(
              'flex h-10 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none',
              'focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-primary-600',
              'placeholder:text-neutral-400 ps-3 pe-3',
              error ? 'border-error ring-[3px] ring-error/25' : 'border-input',
            )}
          />
          <button
            type="button"
            onClick={addItem}
            disabled={!draft.trim()}
            aria-label={t('addButton')}
            className="inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-md border border-neutral-200 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 hover:border-neutral-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 min-w-[44px]"
          >
            <Plus className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t('addButton')}</span>
          </button>
        </div>
      )}

      {error && (
        <p id={errorId} role="alert" className="text-xs text-error-fg font-medium">
          {error}
        </p>
      )}
      <p className="text-xs text-neutral-400">
        {t('countHint', { count: value.length, max: MAX_ITEMS })}
      </p>
    </div>
  );
}
