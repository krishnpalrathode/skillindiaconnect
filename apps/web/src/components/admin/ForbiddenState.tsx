'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * What the caller sees when the SERVER says no.
 *
 * This is the other half of the permission-driven nav. Hiding a link keeps the
 * console tidy; it does not keep anyone out — a moderator can still type
 * /admin/settings. When they do, the screen's data call returns 403 and we render
 * THIS: an honest explanation, not a crash, a blank page, or a raw error dump.
 *
 * The nav is UX. This, and the 403 behind it, is the control.
 *
 * `role="alert"` so a screen reader announces it — a sighted user sees the page
 * change, and someone on a screen reader must be told too, not left on a page
 * that silently stopped loading.
 */
export function ForbiddenState({
  requiredPermission,
  onRetry,
}: {
  /** The key the server said was missing (`meta.requiredPermission`), if it told us. */
  requiredPermission?: string;
  onRetry?: () => void;
}) {
  const t = useTranslations('admin.forbidden');

  return (
    <div
      role="alert"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center"
    >
      <ShieldAlert className="size-12 text-warning-fg" aria-hidden="true" />
      <h1 className="text-xl font-semibold text-neutral-900">{t('title')}</h1>
      <p className="max-w-md text-sm text-neutral-600">{t('body')}</p>

      {requiredPermission && (
        <p className="text-xs text-neutral-500">
          {t('requires')}{' '}
          <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono">
            {requiredPermission}
          </code>
        </p>
      )}

      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </div>
  );
}
