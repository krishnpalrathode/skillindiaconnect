'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import type { Setting } from '@/lib/api/admin-settings';
import { Toggle } from '@/components/common/Toggle';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';

/**
 * One setting, one typed editor, one save.
 *
 * The editor type comes from the RUNTIME TYPE of the current value (the server
 * sends no type metadata — the value itself carries it): boolean → switch,
 * number → numeric field, string[] → removable chips + add box.
 *
 * SAVE SCOPE IS PER ROW, deliberately. The API accepts batches, but Screen 28
 * saves one key per click: a platform setting is not a form — "save all" means a
 * fat-fingered toggle three rows up ships inside an unrelated change, and the
 * audit trail shows one blob instead of one decision. Dirty state is visible
 * (Save/Discard appear only when the value differs); a FAILED save reverts the
 * row to the server value and says why — the row never quietly displays a value
 * the server rejected.
 *
 * Booleans are dirty-then-save like everything else (not save-on-flip): a switch
 * that commits on click has no "actually, no" moment, and these are platform-wide
 * rules.
 */
export function SettingRow({
  setting,
  disabled,
  disabledReason,
  onSave,
  confirmBeforeSave,
}: {
  setting: Setting;
  /** Locked rendering (core rule for a non-super) — the editor is inert. */
  disabled?: boolean;
  disabledReason?: string;
  /** Persist ONE key. Must throw on failure (the row reverts + surfaces it). */
  onSave: (key: string, value: unknown) => Promise<void>;
  /**
   * CoreRuleCell's seam: called with the pending value before saving; return
   * false to abort (e.g. the user cancelled the consequence dialog).
   */
  confirmBeforeSave?: (pendingValue: unknown) => Promise<boolean>;
}) {
  const t = useTranslations('admin.settings');
  const tToast = useTranslations('toast');
  const { showToast } = useToast();
  const [draft, setDraft] = useState<unknown>(setting.value);
  const [chipDraft, setChipDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(setting.value);
  const rowId = `setting-${setting.key.replace(/\./g, '-')}`;

  // Labels/descriptions are CLIENT i18n keyed by the setting key — the server
  // deliberately sends none (they're localizable copy, not data).
  const label = t(`keys.${setting.key}.label`);
  const description = t(`keys.${setting.key}.description`);

  async function save() {
    setError(null);
    if (confirmBeforeSave && !(await confirmBeforeSave(draft))) return;
    setSaving(true);
    try {
      await onSave(setting.key, draft);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
      showToast({ message: tToast('settingsSaved') });
    } catch (err) {
      // Revert: the row shows the server's truth, never the rejected draft.
      setDraft(setting.value);
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setDraft(setting.value);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-2 border-b border-neutral-100 py-4 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p id={`${rowId}-label`} className="text-sm font-medium text-neutral-900">
            {label}
          </p>
          <p className="mt-0.5 text-xs text-neutral-600">{description}</p>
          {disabledReason && (
            <p
              // eslint-disable-next-line no-restricted-syntax -- explains a DISABLED control; WCAG 1.4.3 exempts disabled UI.
              className="mt-1 text-xs font-medium text-neutral-500"
            >
              {disabledReason}
            </p>
          )}
        </div>

        {/* The typed editor */}
        <div className="flex items-center gap-3">
          {typeof setting.value === 'boolean' && (
            <Toggle
              checked={draft as boolean}
              onChange={(next) => !disabled && setDraft(next)}
              disabled={disabled}
              label={disabledReason ? `${label} — ${disabledReason}` : label}
              id={rowId}
            />
          )}

          {typeof setting.value === 'number' && (
            <input
              id={rowId}
              type="number"
              value={draft as number}
              min={0}
              disabled={disabled}
              aria-labelledby={`${rowId}-label`}
              onChange={(e) => setDraft(Number(e.target.value))}
              className="min-h-[44px] w-28 rounded-lg border border-neutral-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 disabled:opacity-50"
            />
          )}
        </div>
      </div>

      {/* string[] editor gets the full row width */}
      {Array.isArray(setting.value) && (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-wrap gap-1.5" aria-labelledby={`${rowId}-label`}>
            {(draft as string[]).map((item) => (
              <li
                key={item}
                className="flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700"
              >
                {item}
                {!disabled && (
                  <button
                    type="button"
                    aria-label={t('removeItemAria', { item })}
                    onClick={() => setDraft((draft as string[]).filter((v) => v !== item))}
                    className="rounded-full p-0.5 hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!disabled && (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const v = chipDraft.trim();
                if (v && !(draft as string[]).includes(v)) {
                  setDraft([...(draft as string[]), v]);
                }
                setChipDraft('');
              }}
            >
              <label htmlFor={`${rowId}-add`} className="sr-only">
                {t('addItemLabel')}
              </label>
              <input
                id={`${rowId}-add`}
                value={chipDraft}
                onChange={(e) => setChipDraft(e.target.value)}
                placeholder={t('addItemPlaceholder')}
                className="min-h-[44px] w-56 rounded-lg border border-neutral-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
              />
              <Button type="submit" variant="outline" size="sm">
                {t('addItem')}
              </Button>
            </form>
          )}
        </div>
      )}

      {/* Dirty rail: appears only when there is something to decide. */}
      {dirty && !disabled && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving && <Spinner size={14} label="" />}
            {t('save')}
          </Button>
          <Button size="sm" variant="outline" onClick={discard} disabled={saving}>
            {t('discard')}
          </Button>
        </div>
      )}

      {savedFlash && (
        <p role="status" className="text-xs font-medium text-success-fg">
          {t('saved')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs font-medium text-error-fg">
          {error}
        </p>
      )}
    </div>
  );
}
