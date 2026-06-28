'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Toggle } from '@/components/common/Toggle';
import { patchCandidateSettings } from '@/lib/api/candidate';

type CandidateProfile = components['schemas']['CandidateProfile'];

interface AccountSettingsSectionProps {
  profile: CandidateProfile;
  onProfileUpdate: (p: CandidateProfile) => void;
}

interface Settings {
  showPhone: boolean;
  showReligion: boolean;
  waNotifications: boolean;
  emailNotifs: boolean;
  profileVisible: boolean;
  isAvailable: boolean;
}

function readSettings(profile: CandidateProfile): Settings {
  const p = profile as CandidateProfile & Record<string, unknown>;
  return {
    showPhone: typeof p['showPhone'] === 'boolean' ? (p['showPhone'] as boolean) : true,
    showReligion: typeof p['showReligion'] === 'boolean' ? (p['showReligion'] as boolean) : false,
    waNotifications:
      typeof p['waNotifications'] === 'boolean' ? (p['waNotifications'] as boolean) : true,
    emailNotifs: typeof p['emailNotifs'] === 'boolean' ? (p['emailNotifs'] as boolean) : true,
    profileVisible: profile.profileVisible ?? true,
    isAvailable: profile.isAvailable ?? true,
  };
}

interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  saving?: boolean;
}

function ToggleRow({ label, hint, checked, onChange, saving }: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-neutral-100 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-neutral-800">{label}</p>
        {hint && <p className="text-xs text-neutral-500 mt-0.5">{hint}</p>}
      </div>
      <Toggle
        checked={checked}
        onChange={onChange}
        label={label}
        disabled={saving}
        className="shrink-0 mt-0.5"
      />
    </div>
  );
}

export function AccountSettingsSection({ profile, onProfileUpdate }: AccountSettingsSectionProps) {
  const t = useTranslations('profile.settings');
  const tSec = useTranslations('profile.sections');

  const [settings, setSettings] = useState<Settings>(() => readSettings(profile));
  const [toggleSaving, setToggleSaving] = useState(false);

  // Salary draft
  const [salaryMin, setSalaryMin] = useState(String(profile.salaryExpectationMin ?? ''));
  const [salaryMax, setSalaryMax] = useState(String(profile.salaryExpectationMax ?? ''));
  const [currency, setCurrency] = useState(profile.salaryExpectationCurrency ?? 'INR');
  const [salarySaving, setSalarySaving] = useState(false);

  async function applyToggle(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    setToggleSaving(true);
    try {
      const updated = await patchCandidateSettings(next);
      onProfileUpdate(updated);
    } finally {
      setToggleSaving(false);
    }
  }

  async function saveSalary() {
    setSalarySaving(true);
    try {
      const updated = await patchCandidateSettings({
        salaryExpectationMin: salaryMin ? Number(salaryMin) : undefined,
        salaryExpectationMax: salaryMax ? Number(salaryMax) : undefined,
        salaryExpectationCurrency: currency,
      });
      onProfileUpdate(updated);
    } finally {
      setSalarySaving(false);
    }
  }

  return (
    <section
      aria-label={tSec('accountSettings')}
      className="bg-white rounded-xl border border-neutral-200 shadow-sm"
    >
      <div className="flex items-center px-5 py-4 border-b border-neutral-100">
        <h2 className="text-base font-semibold text-neutral-900">{tSec('accountSettings')}</h2>
      </div>

      <div className="px-5 py-4 flex flex-col gap-6">
        {/* Privacy controls */}
        <div>
          <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
            {t('privacyHeading')}
          </h3>
          <div>
            <ToggleRow
              label={t('showPhone')}
              hint={t('showPhoneHint')}
              checked={settings.showPhone}
              onChange={(v) => applyToggle({ showPhone: v })}
              saving={toggleSaving}
            />
            <ToggleRow
              label={t('showReligion')}
              hint={t('showReligionHint')}
              checked={settings.showReligion}
              onChange={(v) => applyToggle({ showReligion: v })}
              saving={toggleSaving}
            />
            <ToggleRow
              label={t('profileVisible')}
              checked={settings.profileVisible}
              onChange={(v) => applyToggle({ profileVisible: v })}
              saving={toggleSaving}
            />
            <ToggleRow
              label={t('isAvailable')}
              checked={settings.isAvailable}
              onChange={(v) => applyToggle({ isAvailable: v })}
              saving={toggleSaving}
            />
          </div>
        </div>

        {/* Notifications */}
        <div>
          <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
            {t('notificationsHeading')}
          </h3>
          <div>
            <ToggleRow
              label={t('waNotifications')}
              checked={settings.waNotifications}
              onChange={(v) => applyToggle({ waNotifications: v })}
              saving={toggleSaving}
            />
            <ToggleRow
              label={t('emailNotifications')}
              checked={settings.emailNotifs}
              onChange={(v) => applyToggle({ emailNotifs: v })}
              saving={toggleSaving}
            />
          </div>
        </div>

        {/* Salary expectation */}
        <div>
          <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">
            {t('salaryHeading')}
          </h3>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field id="salary-min" label={t('salaryMinLabel')}>
                <Input
                  type="number"
                  min={0}
                  value={salaryMin}
                  onChange={(e) => setSalaryMin(e.target.value)}
                  placeholder={t('salaryMinPlaceholder')}
                />
              </Field>
              <Field id="salary-max" label={t('salaryMaxLabel')}>
                <Input
                  type="number"
                  min={0}
                  value={salaryMax}
                  onChange={(e) => setSalaryMax(e.target.value)}
                  placeholder={t('salaryMaxPlaceholder')}
                />
              </Field>
            </div>
            <Field id="salary-currency" label={t('currencyLabel')}>
              <select
                id="salary-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-background ps-3 pe-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
              >
                <option value="INR">INR — Indian Rupee</option>
                <option value="AED">AED — UAE Dirham</option>
                <option value="SAR">SAR — Saudi Riyal</option>
                <option value="USD">USD — US Dollar</option>
              </select>
            </Field>
            <p className="text-xs text-neutral-500">{t('salaryNote')}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={salarySaving}
              onClick={saveSalary}
              className="self-start"
            >
              {t('saveSalary')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
