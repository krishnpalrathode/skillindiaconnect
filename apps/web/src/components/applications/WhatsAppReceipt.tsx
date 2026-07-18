'use client';

import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';

interface WhatsAppReceiptProps {
  /** The application's `selectedNotifiedAt` — the ONLY source of this indicator. */
  notifiedAt: string;
  locale: string;
}

/**
 * The once-per-application "Selected" WhatsApp receipt. Rendered ONLY from the
 * `selectedNotifiedAt` FIELD — never inferred from status — so a re-entered
 * SELECTED still shows the ORIGINAL notification date. Text-backed (not icon-only)
 * so it's conveyed to screen readers and beyond color.
 */
export function WhatsAppReceipt({ notifiedAt, locale }: WhatsAppReceiptProps) {
  const t = useTranslations('applications.receipt');
  const date = new Date(notifiedAt).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return (
    <p className="flex items-center gap-1.5 text-xs font-medium text-success-fg">
      <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{t('notified', { date })}</span>
    </p>
  );
}
