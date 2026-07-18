'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';

/**
 * "Regenerate to apply" notice (S7-F2). Settings apply at GENERATION, so editing
 * them updates F1's live preview but NOT an already-generated PDF. This appears
 * after a committed settings change to keep that honest.
 *
 * It is a non-blocking `status` (announced politely, not a modal) — the actual
 * regenerate is F1's always-available Regenerate / Download PDF action.
 */
export function RegeneratePrompt() {
  const t = useTranslations('resume');
  return (
    <p
      role="status"
      aria-live="polite"
      className="flex items-start gap-1.5 rounded-md border border-warning-fg/30 bg-warning-fg/5 px-3 py-2 text-xs text-neutral-700"
    >
      <RefreshCw className="mt-0.5 size-3.5 shrink-0 text-warning-fg" aria-hidden="true" />
      {t('regeneratePrompt')}
    </p>
  );
}
