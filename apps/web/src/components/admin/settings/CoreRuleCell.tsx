'use client';

import React, { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock, TriangleAlert } from 'lucide-react';
import type { Setting } from '@/lib/api/admin-settings';
import { useAdmin } from '@/lib/admin/admin-context';
import { ActionDialogShell } from '@/components/admin/employers/ActionDialogShell';
import { SettingRow } from './SettingRow';

/**
 * The worker-protection trio (accommodation / health insurance / transportation
 * required) — the one place in the product where a settings toggle can make the
 * platform LESS SAFE for the people it exists to protect.
 *
 * Two layers, different jobs:
 *
 * 1. NON-SUPER-ADMIN → the row renders LOCKED (lock icon + "Super Admin only";
 *    the switch is disabled with the reason in its accessible name). This is a
 *    COURTESY. The server's 403 CORE_RULE_FORBIDDEN is the guarantee — and if
 *    that 403 arrives anyway (a stale role, a forced request), SettingRow's
 *    failure path already reverts the row and states the error. No crash.
 *
 * 2. SUPER_ADMIN TURNING A RULE **OFF** → a consequence dialog that names, in
 *    plain words, what the click does: jobs become publishable without that
 *    protection. The friction is deliberate and directional — turning a
 *    protection ON asks nothing, because more safety needs no ceremony.
 *
 * Changes take effect immediately for new publish attempts (S2-B1's settings
 * cache invalidation) — the confirm copy says so, because "when does this
 * apply?" should not be a guess.
 */
export function CoreRuleCell({
  setting,
  onSave,
}: {
  setting: Setting;
  onSave: (key: string, value: unknown) => Promise<void>;
}) {
  const t = useTranslations('admin.settings');
  const { role } = useAdmin();
  const isSuperAdmin = role === 'SUPER_ADMIN';

  const [confirming, setConfirming] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  // SettingRow calls this before saving; we only interpose on the OFF direction.
  function confirmBeforeSave(pendingValue: unknown): Promise<boolean> {
    if (pendingValue !== false) return Promise.resolve(true);
    setConfirming(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }

  function settle(ok: boolean) {
    setConfirming(false);
    resolver.current?.(ok);
    resolver.current = null;
  }

  const label = t(`keys.${setting.key}.label`);

  return (
    <div className="relative">
      {!isSuperAdmin && (
        <div className="absolute end-0 top-4 flex items-center gap-1 text-neutral-600">
          <Lock className="size-3.5" aria-hidden="true" />
          <span className="text-xs font-medium">{t('coreRule.superAdminOnly')}</span>
        </div>
      )}

      <SettingRow
        setting={setting}
        disabled={!isSuperAdmin}
        disabledReason={!isSuperAdmin ? t('coreRule.superAdminOnly') : undefined}
        onSave={onSave}
        confirmBeforeSave={isSuperAdmin ? confirmBeforeSave : undefined}
      />

      {confirming && (
        <ActionDialogShell
          titleId="core-rule-confirm-title"
          title={t('coreRule.confirmTitle', { label })}
          busy={false}
          confirmLabel={t('coreRule.confirmButton')}
          confirmVariant="destructive"
          onConfirm={() => settle(true)}
          onClose={() => settle(false)}
          cancelLabel={t('coreRule.cancelButton')}
        >
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-warning-bg p-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-fg" aria-hidden="true" />
            <p className="text-sm text-warning-fg">
              {t(`keys.${setting.key}.offConsequence`)} {t('coreRule.weakensProtection')}
            </p>
          </div>
          <p className="mt-2 text-sm text-neutral-600">{t('coreRule.effectImmediate')}</p>
        </ActionDialogShell>
      )}
    </div>
  );
}
