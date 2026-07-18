'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ShieldAlert } from 'lucide-react';
import type { RbacCell } from '@/lib/api/admin-roles';
import { ActionDialogShell } from '@/components/admin/employers/ActionDialogShell';

/**
 * One cell, one confirm — the anti-fat-finger layer of the RBAC editor.
 *
 * The dialog names BOTH SIDES of the change in plain words ("Allow MODERATOR to
 * export system logs?"), because "toggle MODERATOR/logs.export → true" is
 * legible to the person who wrote the seed and to nobody else — and this is the
 * grid where a mis-click matters most. Revokes get the warning treatment;
 * grants are calmer, but both state the fact that matters: it takes effect
 * IMMEDIATELY for every user holding the role (S6a-B2 proved the cache
 * invalidation — the copy reflects reality, not hope).
 */
export function CellConfirmDialog({
  cell,
  permissionLabel,
  busy,
  onConfirm,
  onClose,
}: {
  cell: RbacCell;
  permissionLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('admin.roles.confirm');
  const granting = !cell.enabled; // the pending change is the inverse of current

  return (
    <ActionDialogShell
      titleId="cell-confirm-title"
      title={
        granting
          ? t('grantTitle', { role: cell.role, permission: permissionLabel })
          : t('revokeTitle', { role: cell.role, permission: permissionLabel })
      }
      busy={busy}
      confirmLabel={granting ? t('grantConfirm') : t('revokeConfirm')}
      confirmVariant={granting ? 'primary' : 'destructive'}
      onConfirm={onConfirm}
      onClose={onClose}
      cancelLabel={t('cancel')}
    >
      {!granting && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-warning-bg p-3">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning-fg" aria-hidden="true" />
          <p className="text-sm text-warning-fg">
            {t('revokeBody', { role: cell.role, permission: permissionLabel })}
          </p>
        </div>
      )}
      <p className="mt-2 text-sm text-neutral-600">{t('immediateEffect', { role: cell.role })}</p>
    </ActionDialogShell>
  );
}
