'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { getMatrix, updateCell, type RbacCell, type RbacMatrix } from '@/lib/api/admin-roles';
import { ApiRequestError } from '@/lib/api/client';
import { useAdmin } from '@/lib/admin/admin-context';
import { ForbiddenState } from '@/components/admin/ForbiddenState';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MatrixCell } from './MatrixCell';
import { CellConfirmDialog } from './CellConfirmDialog';

/**
 * Screen 27's grid: permissions as ROWS (grouped by module — the key prefix),
 * roles as COLUMNS, exactly the orientation the API's cell ordering was built
 * for. Sticky headers because 27 rows outgrow a screen.
 *
 * Three load-bearing behaviors:
 *  - READ-ONLY without roles.manage: an ADMIN with roles.view sees the whole
 *    grid (transparency is the point of roles.view) but no cell is editable.
 *  - ONE CELL, ONE CONFIRM, then REFETCH — never optimistic. A security grid
 *    that renders a grant the server rejected is worse than a slow one.
 *  - The expected non-200s render as what they are: 423 locked and the two 422
 *    guardrails are the platform PROTECTING ITSELF, and the copy says so
 *    calmly; only genuinely unexpected failures look like errors.
 *
 * After a successful write, useAdmin().refetch() runs too: if the change
 * touched the CALLER'S OWN role, the nav must react — that is the entire
 * premise of the permission-driven shell.
 */
export function PermissionMatrix() {
  const t = useTranslations('admin.roles');
  const { has, refetch: refetchMyPermissions } = useAdmin();
  const canManage = has('roles.manage');

  const [matrix, setMatrix] = useState<RbacMatrix | null>(null);
  const [error, setError] = useState<ApiRequestError | Error | null>(null);
  const [pending, setPending] = useState<RbacCell | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'guardrail' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setMatrix(await getMatrix());
    } catch (err) {
      setError(err as Error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmFlip() {
    if (!pending) return;
    setBusy(true);
    setNotice(null);
    try {
      await updateCell(pending.role, pending.permission, !pending.enabled);
      setPending(null);
      // The server's grid, not our guess — and our own nav, which may have
      // just changed if the flipped cell was on the caller's role.
      await load();
      refetchMyPermissions();
    } catch (err) {
      setPending(null);
      if (err instanceof ApiRequestError) {
        const code = err.error.code;
        if (code === 'PERMISSION_CELL_LOCKED') {
          setNotice({ kind: 'guardrail', text: t('errors.locked') });
        } else if (code === 'SELF_LOCKOUT_FORBIDDEN') {
          setNotice({ kind: 'guardrail', text: t('errors.selfLockout') });
        } else if (code === 'LAST_MANAGER_FORBIDDEN') {
          setNotice({ kind: 'guardrail', text: t('errors.lastManager') });
        } else {
          setNotice({ kind: 'error', text: err.error.detail });
        }
      } else {
        setNotice({ kind: 'error', text: t('errors.generic') });
      }
      // Nothing was written on any rejection — re-render the server's truth.
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error instanceof ApiRequestError && error.error.status === 403) {
    return (
      <ForbiddenState
        requiredPermission={error.error.meta?.['requiredPermission'] as string | undefined}
      />
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 py-8">
        <p className="text-sm font-medium text-error-fg">{t('loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (!matrix) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  // permission → role → cell, and rows grouped by the key's module prefix, in
  // the API's own ordering (the contract emits keys module-grouped already).
  const cellFor = new Map<string, RbacCell>();
  for (const cell of matrix.cells) cellFor.set(`${cell.role} ${cell.permission}`, cell);

  const groups: Array<{ moduleKey: string; permissions: string[] }> = [];
  for (const permission of matrix.permissions) {
    // NOT named `module` — Next.js forbids assigning that identifier.
    const moduleKey = permission.split('.')[0]!;
    const last = groups[groups.length - 1];
    if (last && last.moduleKey === moduleKey) last.permissions.push(permission);
    else groups.push({ moduleKey, permissions: [permission] });
  }

  return (
    <div className="flex flex-col gap-3">
      {!canManage && (
        <p role="note" className="flex items-center gap-1.5 text-xs text-neutral-600">
          <Lock className="size-3.5 shrink-0" aria-hidden="true" />
          {t('readOnlyNote')}
        </p>
      )}

      {notice && (
        <p
          role="alert"
          className={
            notice.kind === 'guardrail'
              ? 'rounded-lg bg-info-bg p-3 text-sm font-medium text-info-fg'
              : 'rounded-lg bg-error-bg p-3 text-sm font-medium text-error-fg'
          }
        >
          {notice.text}
        </p>
      )}

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('tableCaption')}</caption>
          <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_theme(colors.neutral.200)]">
            <tr>
              <th scope="col" className="p-3 text-start text-xs font-semibold text-neutral-700">
                {t('permissionColumn')}
              </th>
              {matrix.roles.map((role) => (
                <th
                  scope="col"
                  key={role}
                  className="p-3 text-center text-xs font-semibold text-neutral-700"
                >
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <React.Fragment key={group.moduleKey}>
                <tr className="border-b border-neutral-100 bg-neutral-50">
                  <th
                    scope="colgroup"
                    colSpan={1 + matrix.roles.length}
                    className="p-2 ps-3 text-start text-xs font-semibold uppercase tracking-wide text-neutral-600"
                  >
                    {t(`groups.${group.moduleKey}`)}
                  </th>
                </tr>
                {group.permissions.map((permission) => {
                  const label = t(`permissions.${permission.replace('.', '::')}`);
                  return (
                    <tr key={permission} className="border-b border-neutral-100 last:border-0">
                      <th scope="row" className="p-3 text-start font-normal">
                        <span className="block text-sm text-neutral-900">{label}</span>
                        <span className="block font-mono text-[11px] text-neutral-600">
                          {permission}
                        </span>
                      </th>
                      {matrix.roles.map((role) => {
                        const cell = cellFor.get(`${role} ${permission}`);
                        if (!cell)
                          return (
                            <td key={role} className="p-2 text-center">
                              —
                            </td>
                          );
                        return (
                          <td key={role} className="p-2 text-center">
                            <MatrixCell
                              cell={cell}
                              permissionLabel={label}
                              editable={canManage}
                              onToggle={setPending}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {pending && (
        <CellConfirmDialog
          cell={pending}
          permissionLabel={t(`permissions.${pending.permission.replace('.', '::')}`)}
          busy={busy}
          onConfirm={() => void confirmFlip()}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
