'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Check, Lock, Minus } from 'lucide-react';
import type { RbacCell } from '@/lib/api/admin-roles';
import { cn } from '@/lib/utils';

/**
 * One cell of the Screen-27 grid. Three renderings, one truth each:
 *
 *  - LOCKED: a lock icon, disabled, with the REASON in the accessible name —
 *    "SUPER_ADMIN, export system logs: allowed — locked, Super Admin
 *    permissions can't be changed". The whole SUPER_ADMIN column and the seeded
 *    locked set render this way. It is a COURTESY; the server's 423 is what
 *    actually protects the platform.
 *  - EDITABLE (caller holds roles.manage): a real button toggling the grant,
 *    whose accessible name names the cell — a screen-reader user on a 27×4 grid
 *    must know exactly which cell they are about to flip.
 *  - READ-ONLY (roles.view without roles.manage): the state, visibly inert.
 */
export function MatrixCell({
  cell,
  permissionLabel,
  editable,
  onToggle,
}: {
  cell: RbacCell;
  /** The human name of the permission ("export system logs") for a11y names. */
  permissionLabel: string;
  editable: boolean;
  onToggle: (cell: RbacCell) => void;
}) {
  const t = useTranslations('admin.roles');

  const stateLabel = cell.enabled ? t('cell.allowed') : t('cell.notAllowed');
  const baseName = `${cell.role}, ${permissionLabel}: ${stateLabel}`;

  if (cell.locked) {
    return (
      <span
        role="img"
        aria-label={`${baseName} — ${t('cell.lockedReason')}`}
        title={t('cell.lockedReason')}
        className="inline-flex size-11 items-center justify-center rounded-lg text-neutral-600"
      >
        {cell.enabled ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Minus className="size-4" aria-hidden="true" />
        )}
        <Lock className="ms-0.5 size-3" aria-hidden="true" />
      </span>
    );
  }

  if (!editable) {
    return (
      <span
        role="img"
        aria-label={baseName}
        className={cn(
          'inline-flex size-11 items-center justify-center rounded-lg',
          cell.enabled ? 'text-success-fg' : 'text-neutral-300',
        )}
      >
        {cell.enabled ? (
          <Check className="size-5" aria-hidden="true" />
        ) : (
          <Minus className="size-5" aria-hidden="true" />
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={cell.enabled}
      aria-label={`${baseName} — ${t('cell.toggleHint')}`}
      onClick={() => onToggle(cell)}
      className={cn(
        'inline-flex size-11 items-center justify-center rounded-lg border transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
        cell.enabled
          ? 'border-success-fg/30 bg-success-bg text-success-fg hover:border-success-fg/60'
          : 'border-neutral-200 text-neutral-300 hover:border-neutral-400 hover:text-neutral-600',
      )}
    >
      {cell.enabled ? (
        <Check className="size-5" aria-hidden="true" />
      ) : (
        <Minus className="size-5" aria-hidden="true" />
      )}
    </button>
  );
}
