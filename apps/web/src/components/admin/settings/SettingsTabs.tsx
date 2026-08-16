'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  getSettings,
  groupOf,
  updateSetting,
  SETTING_GROUPS,
  type Setting,
  type SettingGroup,
} from '@/lib/api/admin-settings';
import { ApiRequestError } from '@/lib/api/client';
import { ForbiddenState } from '@/components/admin/ForbiddenState';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingRow } from './SettingRow';
import { CoreRuleCell } from './CoreRuleCell';
import { PlanPricingPanel } from './PlanPricingPanel';
import { cn } from '@/lib/utils';

/**
 * Screen 28. Tabs are derived from the setting-key PREFIX (worker_protection.* /
 * jobs.* / candidates.* / payments.*) — the server returns a flat list and
 * grouping is presentation (see admin-settings.ts). A prefix we don't know lands
 * in an "other" tab rather than disappearing: a new backend setting must never
 * be silently unreachable from the console.
 */
export function SettingsTabs() {
  const t = useTranslations('admin.settings');
  const [settings, setSettings] = useState<Setting[] | null>(null);
  const [error, setError] = useState<ApiRequestError | Error | null>(null);
  const [activeTab, setActiveTab] = useState<SettingGroup | 'other'>('worker_protection');

  const load = useCallback(async () => {
    setError(null);
    try {
      setSettings(await getSettings());
    } catch (err) {
      setError(err as Error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ONE save path for every row: persist one key, then adopt the server's
  // returned list wholesale (PATCH returns ALL settings — version bumps,
  // updatedAt, everything — so state is the server's truth, not a local merge).
  async function saveOne(key: string, value: unknown): Promise<void> {
    try {
      const updated = await updateSetting(key, value);
      setSettings(updated);
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.code === 'CORE_RULE_FORBIDDEN') {
        // The graceful shape of the guarantee: a stale role or forced request
        // gets the server's answer, worded for a human, and the row reverts.
        throw new Error(t('coreRule.forbidden'));
      }
      throw err instanceof ApiRequestError ? new Error(err.error.detail) : (err as Error);
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

  if (!settings) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-10 w-2/3 rounded-lg" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const grouped = new Map<string, Setting[]>();
  for (const s of settings) {
    const g = groupOf(s);
    grouped.set(g, [...(grouped.get(g) ?? []), s]);
  }
  const tabs: Array<SettingGroup | 'other'> = [
    ...SETTING_GROUPS.filter((g) => grouped.has(g)),
    ...(grouped.has('other') ? (['other'] as const) : []),
  ];
  const visible = grouped.get(activeTab) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label={t('tabsLabel')} className="flex flex-wrap gap-1">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'min-h-[44px] rounded-lg px-3 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
              activeTab === tab
                ? 'bg-primary-50 font-semibold text-primary-700'
                : 'text-neutral-600 hover:bg-neutral-100',
            )}
          >
            {t(`groups.${tab}`)}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        aria-label={t(`groups.${activeTab}`)}
        className="rounded-xl border border-neutral-200 bg-white px-4"
      >
        {visible.map((setting) =>
          setting.isCoreRule ? (
            <CoreRuleCell key={setting.key} setting={setting} onSave={saveOne} />
          ) : (
            <SettingRow key={setting.key} setting={setting} onSave={saveOne} />
          ),
        )}

        {/* Plan prices live under Payments beside the GST rate: both decide what
            an employer is charged. They are NOT `Setting` rows — prices are their
            own table with their own endpoint and their own money rules — so the
            panel mounts here rather than being forced into the key/value list. */}
        {activeTab === 'payments' && <PlanPricingPanel />}
      </div>
    </div>
  );
}
