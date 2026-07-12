'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUp } from 'lucide-react';

/**
 * The ?upgrade=quota banner (S5-F1).
 *
 * Rendered when the employer lands here from S2-F4's JOB_QUOTA_EXCEEDED link
 * (/subscription?upgrade=quota). Explains WHY they're here — the Free plan's
 * 1-job cap — and the plan cards below pre-emphasize Pro.
 */
export function UpgradeContext() {
  const t = useTranslations('billing');
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-primary-300 bg-primary-50 p-4"
    >
      <ArrowUp className="size-5 text-primary-600 shrink-0 mt-0.5" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold text-primary-800">{t('quotaBannerTitle')}</p>
        <p className="text-sm text-primary-700 mt-0.5">{t('quotaBannerBody')}</p>
      </div>
    </div>
  );
}
