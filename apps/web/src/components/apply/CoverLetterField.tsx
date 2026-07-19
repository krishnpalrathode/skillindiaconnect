'use client';

import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export const COVER_LETTER_MAX = 500;

interface CoverLetterFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * Optional cover letter, ≤500 chars. `maxLength` blocks over-limit input
 * client-side; the live counter is aria-live so screen readers announce the
 * remaining budget. The server also enforces the cap — this is UX, not the gate.
 */
export function CoverLetterField({ value, onChange, disabled }: CoverLetterFieldProps) {
  const t = useTranslations('apply.coverLetter');
  const atLimit = value.length >= COVER_LETTER_MAX;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="apply-cover-letter">{t('label')}</Label>
      <textarea
        id="apply-cover-letter"
        value={value}
        rows={4}
        maxLength={COVER_LETTER_MAX}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('placeholder')}
        aria-describedby="apply-cover-letter-counter"
        className={cn(
          'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900',
          'placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      />
      <p
        id="apply-cover-letter-counter"
        aria-live="polite"
        className={cn('text-xs text-end', atLimit ? 'text-warning-fg' : 'text-neutral-600')}
      >
        {t('counter', { n: value.length, max: COVER_LETTER_MAX })}
      </p>
    </div>
  );
}
