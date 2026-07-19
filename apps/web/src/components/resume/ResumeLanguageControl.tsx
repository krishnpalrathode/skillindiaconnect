'use client';

import React, { useId } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Resume language control (S7-F2) — ENGLISH-ONLY, honestly.
 *
 * The PDF renders English only (B1); the `ResumeSettings.language` enum lists
 * only `en`. So this renders a DISABLED select whose sole option is English —
 * there is deliberately NO Hindi/Arabic option to pick. A functional-looking
 * HI/AR toggle that silently produced an English PDF would be a lie; a disabled
 * "more languages coming soon" is the honest surface. The surrounding UI still
 * localizes (EN/HI/AR) — only the PDF's content language is fixed.
 */
export function ResumeLanguageControl() {
  const t = useTranslations('resume.settings');
  const id = useId();

  return (
    <div className="flex flex-col gap-1 border-b border-neutral-100 py-3 last:border-0">
      <label htmlFor={id} className="text-sm font-medium text-neutral-800">
        {t('language')}
      </label>
      <select
        id={id}
        disabled
        value="en"
        aria-describedby={`${id}-note`}
        className="w-full max-w-xs cursor-not-allowed rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700 disabled:opacity-100"
      >
        {/* Only English exists — no HI/AR option to select. */}
        <option value="en">{t('languageEnglish')}</option>
      </select>
      <p id={`${id}-note`} className="text-xs text-neutral-600">
        {t('languageComingSoon')}
      </p>
    </div>
  );
}
