'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { exportLogs, type LogQuery } from '@/lib/api/admin-logs';
import { ApiRequestError } from '@/lib/api/client';
import { PermissionGate } from '@/components/admin/PermissionGate';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/**
 * Bulk extraction of the audit trail — the riskiest button on Screen 29, so it
 * carries all four controls the endpoint was designed with, made VISIBLE:
 *
 *  1. GATED on `logs.export` (a separate, higher key than logs.view — a
 *     MODERATOR reads pages on screen and never sees this button at all).
 *  2. FILTER-EXPLICIT: the label says the CURRENT FILTERS are what's exported —
 *     no one should be surprised by what lands in the CSV.
 *  3. CAP-AWARE: a 422 EXPORT_TOO_LARGE renders as the actionable "narrow the
 *     range or add filters" state, with the server's caps from the error meta —
 *     not a generic failure.
 *  4. SELF-AUDITING, and it SAYS so: the export writes its own audit row naming
 *     the exporter. An admin should extract the trail knowing the trail records
 *     the extraction.
 */
export function ExportButton({
  query,
  approximateCount,
}: {
  query: LogQuery;
  /** The rows loaded so far — the honest "these {n}+ results" framing. */
  approximateCount: number;
}) {
  const t = useTranslations('admin.logs.export');
  const [busy, setBusy] = useState(false);
  const [tooLarge, setTooLarge] = useState<{ maxRows?: number; maxRangeDays?: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setTooLarge(null);
    try {
      const { blob, filename } = await exportLogs(query);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename ?? 'audit-log.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.code === 'EXPORT_TOO_LARGE') {
        setTooLarge({
          maxRows: err.error.meta?.['maxRows'] as number | undefined,
          maxRangeDays: err.error.meta?.['maxRangeDays'] as number | undefined,
        });
      } else if (err instanceof ApiRequestError) {
        setError(err.error.detail);
      } else {
        setError(t('failed'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <PermissionGate permission="logs.export">
      <div className="flex flex-col items-end gap-1.5">
        <Button variant="outline" size="sm" onClick={() => void run()} disabled={busy}>
          {busy ? (
            <Spinner size={14} label="" />
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
          {t('button', { count: approximateCount })}
        </Button>
        <p className="text-xs text-neutral-400">{t('selfAuditNote')}</p>

        {tooLarge && (
          <p
            role="alert"
            className="max-w-sm rounded-lg bg-warning-bg p-2.5 text-end text-xs text-warning-fg"
          >
            {tooLarge.maxRows !== undefined && tooLarge.maxRangeDays !== undefined
              ? t('tooLargeWithCaps', {
                  maxRows: tooLarge.maxRows,
                  maxRangeDays: tooLarge.maxRangeDays,
                })
              : t('tooLarge')}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs font-medium text-error-fg">
            {error}
          </p>
        )}
      </div>
    </PermissionGate>
  );
}
