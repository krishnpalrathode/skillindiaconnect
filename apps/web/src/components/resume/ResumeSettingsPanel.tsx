'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlidersHorizontal } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { patchResumeSettings, type ResumeSettingsPatch } from '@/lib/api/resume';
import { SettingToggleRow } from './SettingToggleRow';
import { ResumeLanguageControl } from './ResumeLanguageControl';

type ResumeSettings = components['schemas']['ResumeSettings'];

interface ResumeSettingsPanelProps {
  /** The current settings (owned by the hub, so F1's preview reflects them). */
  settings: ResumeSettings;
  /** Optimistically apply a settings change (drives F1's preview) and roll back. */
  onSettingsChange: (next: ResumeSettings) => void;
  /** Fired after a PATCH commits — the hub surfaces "regenerate to apply". */
  onCommitted?: () => void;
}

/**
 * Resume Settings panel (S7-F2, CR-001 B4) — mounts into F1's export-hub seam.
 *
 * Each toggle is framed "show this on your resume". Show Religion + Show Passport
 * Number DEFAULT OFF (the resume is forwarded to strangers — a passport number /
 * religion on a CV is real exposure) and carry a sensitivity note. A change is
 * OPTIMISTIC — the preview updates immediately — then PATCHed; a failed PATCH
 * rolls the toggle back. Settings apply at GENERATION, so a committed change asks
 * the candidate to regenerate (via `onCommitted` → the hub's RegeneratePrompt).
 *
 * The language control is English-only and honest — no fake HI/AR option.
 */
export function ResumeSettingsPanel({
  settings,
  onSettingsChange,
  onCommitted,
}: ResumeSettingsPanelProps) {
  const t = useTranslations('resume.settings');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function applyToggle(key: keyof ResumeSettingsPatch, value: boolean) {
    const prev = settings;
    onSettingsChange({ ...settings, [key]: value }); // optimistic → preview reacts
    setSaving(true);
    setError(null);
    try {
      const updated = await patchResumeSettings({ [key]: value });
      onSettingsChange(updated);
      onCommitted?.();
    } catch {
      onSettingsChange(prev); // rollback the failed toggle
      setError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label={t('title')} className="flex flex-col gap-2.5">
      <h4 className="flex items-center gap-2.5 text-sm font-bold text-neutral-800">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#E8F0FE] text-[#0F3D91]">
          <SlidersHorizontal className="size-4" aria-hidden="true" />
        </span>
        {t('title')}
      </h4>

      <div className="rounded-[22px] border border-neutral-200/70 bg-white px-5 shadow-sm">
        <SettingToggleRow
          label={t('showPhone')}
          checked={settings.showPhone}
          onChange={(v) => applyToggle('showPhone', v)}
          saving={saving}
        />
        <SettingToggleRow
          label={t('showFatherName')}
          checked={settings.showFatherName}
          onChange={(v) => applyToggle('showFatherName', v)}
          saving={saving}
        />
        <SettingToggleRow
          label={t('showReligion')}
          note={t('religionNote')}
          checked={settings.showReligion}
          onChange={(v) => applyToggle('showReligion', v)}
          saving={saving}
        />
        <SettingToggleRow
          label={t('showPassportNumber')}
          note={t('passportNote')}
          checked={settings.showPassportNumber}
          onChange={(v) => applyToggle('showPassportNumber', v)}
          saving={saving}
        />
        <ResumeLanguageControl />
      </div>

      {error && (
        <p role="alert" className="text-xs text-error-fg">
          {error}
        </p>
      )}
    </section>
  );
}
