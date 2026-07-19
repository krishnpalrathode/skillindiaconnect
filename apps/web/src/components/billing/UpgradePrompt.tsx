'use client';

import React from 'react';
import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import { Lock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UpgradePromptProps {
  onDismiss: () => void;
}

export function UpgradePrompt({ onDismiss }: UpgradePromptProps) {
  const t = useTranslations('billing.manage');
  const locale = useLocale();

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t('upgradeDialogTitle')}
      className="mt-1 flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-100">
            <Lock className="size-3 text-primary-600" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold text-neutral-900">{t('upgradeDialogTitle')}</p>
            <p className="mt-0.5 text-xs text-neutral-600">{t('upgradeDialogBody')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded p-0.5 text-neutral-600 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          aria-label={t('upgradeDialogClose')}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <Button asChild size="sm" className="w-full text-xs">
        <Link href={`/${locale}/employer/subscription?upgrade=documents`}>
          {t('upgradeDialogCta')}
        </Link>
      </Button>
    </div>
  );
}
