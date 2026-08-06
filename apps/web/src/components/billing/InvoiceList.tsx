'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Download, FileText, Loader2 } from 'lucide-react';
import { getInvoices } from '@/lib/api/billing';
import { formatSubunits } from '@/lib/money';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import type { components } from '@skillindiaconnect/shared-types';
import { formatDate } from '@/lib/format/date';

type Invoice = components['schemas']['Invoice'];

export function InvoiceList() {
  const t = useTranslations('billing.manage');
  const locale = useLocale();

  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = React.useCallback(async () => {
    setIsLoading(true);
    setError(false);
    try {
      const res = await getInvoices(1, 20);
      setInvoices(res);
    } catch {
      setError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section
      aria-labelledby="invoices-heading"
      className="rounded-[18px] border border-neutral-200/70 bg-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-md sm:p-6"
    >
      <h2 id="invoices-heading" className="mb-4 text-base font-semibold text-neutral-900">
        {t('invoicesTitle')}
      </h2>

      {isLoading && (
        <ul className="flex flex-col divide-y divide-neutral-100" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-3">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3.5 w-20" />
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-sm text-neutral-600">{t('invoicesLoadError')}</p>
          <Button variant="outline" size="sm" onClick={load}>
            {t('retry')}
          </Button>
        </div>
      )}

      {!isLoading && !error && invoices !== null && invoices.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <FileText className="size-8 text-neutral-300" aria-hidden="true" />
          <p className="text-sm text-neutral-600">{t('invoicesEmpty')}</p>
        </div>
      )}

      {!isLoading && !error && invoices && invoices.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label={t('invoicesTitle')}>
            <thead>
              <tr className="border-b border-neutral-100 text-start">
                <th
                  scope="col"
                  className="pb-2 text-start text-xs font-medium text-neutral-600 pe-4"
                >
                  {t('invoiceNumber')}
                </th>
                <th
                  scope="col"
                  className="pb-2 text-start text-xs font-medium text-neutral-600 pe-4"
                >
                  {t('invoiceDate')}
                </th>
                <th
                  scope="col"
                  className="pb-2 text-start text-xs font-medium text-neutral-600 pe-4"
                >
                  {t('invoicePlan')}
                </th>
                <th scope="col" className="pb-2 text-end text-xs font-medium text-neutral-600">
                  {t('invoiceAmount')}
                </th>
                <th scope="col" className="pb-2 ps-4 text-end text-xs font-medium text-neutral-600">
                  <span className="sr-only">{t('invoiceActions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {invoices.map((inv) => (
                <InvoiceRow key={inv.id} invoice={inv} locale={locale} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function InvoiceRow({ invoice, locale }: { invoice: Invoice; locale: string }) {
  const t = useTranslations('billing.manage');

  return (
    <tr className="group">
      <td className="py-3 pe-4 font-mono text-xs text-neutral-700 tabular-nums">
        {invoice.number}
      </td>
      <td className="py-3 pe-4 text-xs text-neutral-600">{formatDate(invoice.issuedAt, locale)}</td>
      <td className="py-3 pe-4 text-xs text-neutral-700">{invoice.planName}</td>
      <td className="py-3 text-end text-xs font-medium text-neutral-900 tabular-nums">
        {formatSubunits(invoice.totalSubunits, invoice.currency, locale)}
      </td>
      <td className="py-3 ps-4 text-end">
        {invoice.pdfUrl ? (
          <a
            href={invoice.pdfUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded text-xs font-medium text-primary-600 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            aria-label={t('downloadPdfLabel', { number: invoice.number })}
          >
            <Download className="size-3.5" aria-hidden="true" />
            {t('downloadPdf')}
          </a>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-neutral-600">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            {t('pdfPending')}
          </span>
        )}
      </td>
    </tr>
  );
}
