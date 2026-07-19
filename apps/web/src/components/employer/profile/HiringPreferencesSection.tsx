'use client';

import React, { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { EditableSection } from '@/components/profile/EditableSection';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { patchHiringPreferences } from '@/lib/api/employer-profile';
import { getJobCategories, type JobCategory } from '@/lib/api/jobs-employer';
import type { components } from '@skillindiaconnect/shared-types';

type HiringPreferences = components['schemas']['HiringPreferences'];
type EmployerProfile = components['schemas']['EmployerProfile'];

interface HiringPreferencesSectionProps {
  profile: EmployerProfile;
  onUpdated: (pref: HiringPreferences) => void;
}

function ChipList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

/**
 * Hiring preferences: categories, nationalities, min experience, notes.
 *
 * The contract stores `preferredCategories` as job-category IDs (they feed the
 * candidate-browse filter), so the editor is a checkbox picker over the real
 * /job-categories enumeration — never free text. Nationalities remain a
 * comma-separated text input (plain strings per contract). The view renders
 * both as readable chips (ids resolved to localized names).
 *
 * Saving flips hasHiringPreferences → the parent refetches the full profile so
 * the checklist nudge updates.
 */
export function HiringPreferencesSection({ profile, onUpdated }: HiringPreferencesSectionProps) {
  const t = useTranslations('employer.profile.hiringPrefs');
  const locale = useLocale();
  const prefs = profile.hiringPreferences;

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<JobCategory[]>([]);

  useEffect(() => {
    getJobCategories()
      .then((r) => setCategories(r.data))
      .catch(() => setCategories([]));
  }, []);

  const categoryName = (cat: JobCategory) =>
    locale === 'hi'
      ? (cat.nameHi ?? cat.nameEn)
      : locale === 'ar'
        ? (cat.nameAr ?? cat.nameEn)
        : cat.nameEn;

  const nameForId = (id: string) => {
    const cat = categories.find((c) => c.id === id);
    return cat ? categoryName(cat) : id;
  };

  const [draft, setDraft] = useState({
    categoryIds: prefs?.preferredCategories ?? [],
    nationalities: prefs?.preferredNationalities?.join(', ') ?? '',
    minExperience: String(prefs?.minExperience ?? 0),
    notes: prefs?.notes ?? '',
  });

  const handleEdit = () => {
    setDraft({
      categoryIds: prefs?.preferredCategories ?? [],
      nationalities: prefs?.preferredNationalities?.join(', ') ?? '',
      minExperience: String(prefs?.minExperience ?? 0),
      notes: prefs?.notes ?? '',
    });
    setError(null);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setError(null);
  };

  const splitCSV = (val: string) =>
    val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const toggleCategory = (id: string) =>
    setDraft((prev) => ({
      ...prev,
      categoryIds: prev.categoryIds.includes(id)
        ? prev.categoryIds.filter((c) => c !== id)
        : [...prev.categoryIds, id],
    }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await patchHiringPreferences({
        preferredCategories: draft.categoryIds,
        preferredNationalities: splitCSV(draft.nationalities),
        minExperience: Math.max(0, parseInt(draft.minExperience, 10) || 0),
        notes: draft.notes.trim() || undefined,
      });
      onUpdated(updated);
      setIsEditing(false);
    } catch {
      setError(t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  const set =
    (field: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft((prev) => ({ ...prev, [field]: e.target.value }));

  const hasPrefs =
    prefs &&
    ((prefs.preferredCategories?.length ?? 0) > 0 ||
      (prefs.preferredNationalities?.length ?? 0) > 0 ||
      (prefs.minExperience ?? 0) > 0 ||
      prefs.notes);

  const viewContent = !hasPrefs ? (
    <p className="text-sm text-neutral-600">{t('emptyHint')}</p>
  ) : (
    <div className="flex flex-col gap-3">
      {(prefs?.preferredCategories?.length ?? 0) > 0 && (
        <div>
          <span className="text-xs text-neutral-600">{t('categoriesLabel')}</span>
          <ChipList items={prefs!.preferredCategories!.map(nameForId)} />
        </div>
      )}
      {(prefs?.preferredNationalities?.length ?? 0) > 0 && (
        <div>
          <span className="text-xs text-neutral-600">{t('nationalitiesLabel')}</span>
          <ChipList items={prefs!.preferredNationalities!} />
        </div>
      )}
      {(prefs?.minExperience ?? 0) > 0 && (
        <div>
          <span className="text-xs text-neutral-600">{t('minExperienceLabel')}</span>
          <p className="text-sm text-neutral-900">{prefs!.minExperience}+</p>
        </div>
      )}
      {prefs?.notes && (
        <div>
          <span className="text-xs text-neutral-600">{t('notesLabel')}</span>
          <p className="text-sm text-neutral-900 whitespace-pre-line">{prefs.notes}</p>
        </div>
      )}
    </div>
  );

  const editForm = (
    <div className="flex flex-col gap-4">
      <fieldset>
        <legend className="text-sm font-medium text-neutral-700">{t('categoriesLabel')}</legend>
        <p className="text-xs text-neutral-600 mt-0.5 mb-2">{t('categoriesHint')}</p>
        {categories.length === 0 ? (
          <p className="text-xs text-neutral-600">{t('categoriesLoading')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <label
                key={cat.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-neutral-50 px-3 py-1.5 text-sm text-neutral-700 cursor-pointer has-[:checked]:border-primary-600 has-[:checked]:bg-primary-50 has-[:checked]:text-primary-700"
              >
                <input
                  type="checkbox"
                  checked={draft.categoryIds.includes(cat.id)}
                  onChange={() => toggleCategory(cat.id)}
                  className="accent-primary-600"
                />
                {categoryName(cat)}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <Field id="hp-nationalities" label={t('nationalitiesLabel')} hint={t('nationalitiesHint')}>
        <Input
          id="hp-nationalities"
          value={draft.nationalities}
          onChange={set('nationalities')}
          placeholder="e.g. Indian, Nepali"
        />
      </Field>
      <Field id="hp-exp" label={t('minExperienceLabel')}>
        <Input
          id="hp-exp"
          type="number"
          min={0}
          max={50}
          value={draft.minExperience}
          onChange={set('minExperience')}
        />
      </Field>
      <Field id="hp-notes" label={t('notesLabel')}>
        <textarea
          id="hp-notes"
          rows={3}
          value={draft.notes}
          onChange={set('notes')}
          placeholder={t('notesPlaceholder')}
          className="flex w-full rounded-md border border-input bg-background ps-3 pe-3 py-2 text-base text-foreground placeholder:text-neutral-600 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-primary-600 resize-y"
        />
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
