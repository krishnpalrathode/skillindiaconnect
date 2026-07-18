'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import type { AuditLogEntry } from '@/lib/api/admin-logs';
import { Badge } from '@/components/ui/badge';
import { LogMetaViewer } from './LogMetaViewer';
import { cn } from '@/lib/utils';

const STATUS_BADGE: Record<string, 'success' | 'error' | 'warning' | 'info' | 'neutral'> = {
  SUCCESS: 'success',
  DELIVERED: 'success',
  FAILED: 'error',
  ERROR: 'error',
  BLOCKED: 'warning',
};

/**
 * One audit entry: the scannable line, plus an expandable meta panel.
 *
 * The expander is a real <button> inside the first cell (keyboard-operable,
 * aria-expanded) and the meta panel is a second <tr> spanning the table — so
 * the table stays a TABLE for screen readers rather than dissolving into divs.
 */
export function LogRow({ entry }: { entry: AuditLogEntry }) {
  const t = useTranslations('admin.logs');
  const [open, setOpen] = useState(false);
  const detailId = `log-meta-${entry.id}`;

  return (
    <>
      <tr className="border-b border-neutral-100 last:border-0">
        <td className="p-2">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            aria-label={t('toggleMetaAria', { action: entry.action })}
            onClick={() => setOpen((o) => !o)}
            className="flex size-11 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <ChevronRight
              className={cn('size-4 transition-transform', open && 'rotate-90')}
              aria-hidden="true"
            />
          </button>
        </td>
        <td className="whitespace-nowrap p-2 text-xs tabular-nums text-neutral-600">
          {new Date(entry.createdAt).toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </td>
        <td className="p-2">
          <Badge variant="neutral">{entry.module}</Badge>
        </td>
        <td className="p-2 font-mono text-xs text-neutral-900">{entry.action}</td>
        <td className="p-2 text-xs text-neutral-600">
          {entry.actorUserId ? (
            <>
              <span className="block max-w-[12rem] truncate font-mono">{entry.actorUserId}</span>
              {entry.actorRole && <span className="text-neutral-400">{entry.actorRole}</span>}
            </>
          ) : (
            <span className="text-neutral-400">{t('systemActor')}</span>
          )}
        </td>
        <td className="p-2 text-xs text-neutral-600">
          {entry.targetType ? (
            <>
              <span className="text-neutral-400">{entry.targetType} </span>
              <span className="font-mono">{entry.targetId ?? '—'}</span>
            </>
          ) : (
            '—'
          )}
        </td>
        <td className="p-2">
          <Badge variant={STATUS_BADGE[entry.status] ?? 'neutral'}>{entry.status}</Badge>
        </td>
      </tr>
      {open && (
        <tr id={detailId} className="border-b border-neutral-100 bg-neutral-50/50 last:border-0">
          <td colSpan={7} className="p-3 ps-14">
            <LogMetaViewer meta={entry.meta} />
          </td>
        </tr>
      )}
    </>
  );
}
