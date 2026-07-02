'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { FileText } from 'lucide-react';

export function MyApplicationsMini() {
  const t = useTranslations('dashboard.myApplications');

  return (
    <section aria-labelledby="my-applications-heading">
      <h2 id="my-applications-heading" className="text-base font-semibold text-neutral-900 mb-3">
        {t('title')}
      </h2>
      <div className="bg-white rounded-xl border border-neutral-200 px-4 py-8 flex flex-col items-center gap-2 text-neutral-400">
        <FileText className="size-8 opacity-40" aria-hidden="true" />
        <p className="text-sm text-center">{t('coming')}</p>
      </div>
    </section>
  );
}
