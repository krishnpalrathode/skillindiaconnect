'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { EditableSection } from '@/components/profile/EditableSection';
import { Field } from '@/components/ui/field';
import { patchCompany } from '@/lib/api/employer';
import { LOCALES, type Locale } from '@/i18n/locales';
import type { components } from '@skillindiaconnect/shared-types';

type Company = components['schemas']['Company'];

interface AccountSettingsSectionProps {
  company: Company;
  onUpdated: (updated: Company) => void;
}

/**
 * Built from the locale registry so this picker can never fall behind the
 * languages the app actually serves. Labelled "native (English)" because this is
 * a staff-facing field an English-reading admin may also need to scan.
 */
const LANGUAGES = LOCALES.map(({ code, nativeName, englishName }) => ({
  value: code,
  label: nativeName === englishName ? englishName : `${nativeName} (${englishName})`,
}));

type LangValue = Locale;

/**
 * Account settings section — minimal: language preference only.
 *
 * languagePref is the only account-level field in the Company schema accessible
 * to the employer at this tier. More settings (notifications, billing alerts)
 * are planned for later sprints.
 */
export function AccountSettingsSection({ company, onUpdated }: AccountSettingsSectionProps) {
  const t = useTranslations('employer.profile.accountSettings');
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [langDraft, setLangDraft] = useState<LangValue>(
    (company.languagePref as LangValue) ?? 'en',
  );

  const handleEdit = () => {
    setLangDraft((company.languagePref as LangValue) ?? 'en');
    setError(null);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await patchCompany({ languagePref: langDraft });
      onUpdated(updated);
      setIsEditing(false);
    } catch {
      setError(t('saveError'));
      // `false` tells EditableSection the save failed, so it stays quiet and
      // the inline message above is the only thing the user sees.
      return false;
    } finally {
      setSaving(false);
    }
  };

  const currentLang = LANGUAGES.find((l) => l.value === (company.languagePref ?? 'en'));

  const viewContent = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-neutral-600">{t('languageLabel')}</span>
        <span className="text-sm text-neutral-900">{currentLang?.label ?? 'English'}</span>
      </div>
      <p className="text-xs text-neutral-600 border-t border-neutral-100 pt-3">
        {t('moreSettingsNote')}
      </p>
    </div>
  );

  const editForm = (
    <div className="flex flex-col gap-4">
      <Field id="as-lang" label={t('languageLabel')}>
        <select
          id="as-lang"
          value={langDraft}
          onChange={(e) => setLangDraft(e.target.value as LangValue)}
          className="flex h-11 w-full rounded-md border border-input bg-background ps-3 pe-3 py-2 text-base text-foreground transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-primary-600"
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </Field>
      {error && (
        <p className="text-xs text-error-fg font-medium" role="alert">
          {error}
        </p>
      )}
    </div>
  );

  return (
    <EditableSection
      title={t('sectionTitle')}
      isEditing={isEditing}
      onEdit={handleEdit}
      onCancel={handleCancel}
      onSave={handleSave}
      saving={saving}
      form={editForm}
    >
      {viewContent}
    </EditableSection>
  );
}
