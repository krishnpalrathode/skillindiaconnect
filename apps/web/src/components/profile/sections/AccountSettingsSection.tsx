'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Toggle } from '@/components/common/Toggle';
import { useToast } from '@/components/ui/toast';
import { patchCandidateSettings } from '@/lib/api/candidate';
import { CURRENCIES } from '@/lib/currencies';

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
        {hint && <p className="text-xs text-neutral-600 mt-0.5">{hint}</p>}
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
  const tToast = useTranslations('toast');
  const { showToast } = useToast();

  const [settings, setSettings] = useState<Settings>(() => readSettings(profile));
  const [toggleSaving, setToggleSaving] = useState(false);

  // Salary draft
  const [salaryMin, setSalaryMin] = useState(String(profile.salaryExpectationMin ?? ''));
  const [salaryMax, setSalaryMax] = useState(String(profile.salaryExpectationMax ?? ''));
  const [currency, setCurrency] = useState(profile.salaryExpectationCurrency ?? 'INR');
  const [salarySaving, setSalarySaving] = useState(false);

  /*
    Minimum must not exceed maximum. Only compares once BOTH are filled — while
    the candidate is still typing the first number the other box is empty, and
    flagging that would scold them mid-entry. Equal values are allowed: an exact
    expectation is a legitimate answer, not an error.
  */
  const minNum = salaryMin === '' ? null : Number(salaryMin);
  const maxNum = salaryMax === '' ? null : Number(salaryMax);
  const salaryRangeInvalid =
    minNum !== null &&
    maxNum !== null &&
    Number.isFinite(minNum) &&
    Number.isFinite(maxNum) &&
    minNum > maxNum;

  /**
   * `toastKey` names the group the switch belongs to rather than the switch
   * itself. Flipping three privacy switches in a row then reads as one
   * "Privacy settings saved" (the provider collapses repeats) instead of three
   * near-identical cards stacking up.
   */
  async function applyToggle(
    patch: Partial<Settings>,
    toastKey: 'privacySaved' | 'notificationsSaved',
  ) {
    const next = { ...settings, ...patch };
    setSettings(next);
    setToggleSaving(true);
    try {
      const updated = await patchCandidateSettings(next);
      onProfileUpdate(updated);
      showToast({ message: tToast(toastKey) });
    } finally {
      setToggleSaving(false);
    }
  }

  async function saveSalary() {
    // Client-side mirror of the server rule (SALARY_RANGE_INVALID) so the user
    // is told before a round-trip. The server remains the enforcement point —
    // this only saves a failed request.
    if (salaryRangeInvalid) return;

    setSalarySaving(true);
    try {
      const updated = await patchCandidateSettings({
        salaryExpectationMin: salaryMin ? Number(salaryMin) : undefined,
        salaryExpectationMax: salaryMax ? Number(salaryMax) : undefined,
        salaryExpectationCurrency: currency,
      });
      onProfileUpdate(updated);
      showToast({ message: tToast('salarySaved') });
    } finally {
      setSalarySaving(false);
    }
  }

  return (
    <section
      aria-label={tSec('accountSettings')}
      className="rounded-[18px] border border-neutral-200/70 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md"
    >
      <div className="flex items-center border-b border-neutral-100 px-5 py-4 sm:px-6">
        <h2 className="text-lg font-bold tracking-tight text-neutral-900">
          {tSec('accountSettings')}
        </h2>
      </div>

      <div className="flex flex-col gap-7 px-5 py-5 sm:px-6">
        {/* Privacy controls */}
        <div>
          <h3 className="text-xs font-semibold text-neutral-600 uppercase tracking-wider mb-2">
            {t('privacyHeading')}
          </h3>
          <div>
            <ToggleRow
              label={t('showPhone')}
              hint={t('showPhoneHint')}
              checked={settings.showPhone}
              onChange={(v) => applyToggle({ showPhone: v }, 'privacySaved')}
              saving={toggleSaving}
            />
            <ToggleRow
              label={t('showReligion')}
              hint={t('showReligionHint')}
              checked={settings.showReligion}
              onChange={(v) => applyToggle({ showReligion: v }, 'privacySaved')}
              saving={toggleSaving}
            />
            <ToggleRow
              label={t('profileVisible')}
              checked={settings.profileVisible}
              onChange={(v) => applyToggle({ profileVisible: v }, 'privacySaved')}
              saving={toggleSaving}
            />
            <ToggleRow
              label={t('isAvailable')}
              checked={settings.isAvailable}
              onChange={(v) => applyToggle({ isAvailable: v }, 'privacySaved')}
              saving={toggleSaving}
            />
          </div>
        </div>

        {/* Notifications */}
        <div>
          <h3 className="text-xs font-semibold text-neutral-600 uppercase tracking-wider mb-2">
            {t('notificationsHeading')}
          </h3>
          <div>
            <ToggleRow
              label={t('waNotifications')}
              checked={settings.waNotifications}
              onChange={(v) => applyToggle({ waNotifications: v }, 'notificationsSaved')}
              saving={toggleSaving}
            />
            <ToggleRow
              label={t('emailNotifications')}
              checked={settings.emailNotifs}
              onChange={(v) => applyToggle({ emailNotifs: v }, 'notificationsSaved')}
              saving={toggleSaving}
            />
          </div>
        </div>

        {/* Salary expectation */}
        <div>
          <h3 className="text-xs font-semibold text-neutral-600 uppercase tracking-wider mb-3">
            {t('salaryHeading')}
          </h3>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field id="salary-min" label={t('salaryMinLabel')}>
                <Input
                  className="h-12 rounded-xl"
                  type="number"
                  min={0}
                  value={salaryMin}
                  onChange={(e) => setSalaryMin(e.target.value)}
                  placeholder={t('salaryMinPlaceholder')}
                />
              </Field>
              <Field
                id="salary-max"
                label={t('salaryMaxLabel')}
                // Reported on MAX, not MIN: the maximum is the value that has to
                // rise to resolve the conflict, so the message belongs where the
                // fix is made.
                error={salaryRangeInvalid ? t('salaryRangeError') : undefined}
              >
                <Input
                  className="h-12 rounded-xl"
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
                className="h-12 w-full rounded-xl border border-input bg-background ps-3 pe-3 text-sm transition-colors focus-visible:border-primary-600 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-xs text-neutral-600">{t('salaryNote')}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={salarySaving}
              disabled={salaryRangeInvalid}
              onClick={saveSalary}
              className="min-h-10 self-start rounded-xl bg-gradient-to-r from-[#0F3D91] to-[#2E67B1] px-5 text-white shadow-sm transition-all hover:shadow-md"
            >
              {t('saveSalary')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
