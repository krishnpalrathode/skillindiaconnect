'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { EditableSection } from '@/components/profile/EditableSection';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { patchHiringPreferences } from '@/lib/api/employer-profile';
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
 * Categories and nationalities are stored as string arrays. In this MVP form,
 * the user enters comma-separated values in a text input which are split on save.
 * The view shows them as readable chips.
 *
 * Saving flips hasHiringPreferences → the parent refetches the full profile so
 * the checklist nudge updates.
 */
export function HiringPreferencesSection({ profile, onUpdated }: HiringPreferencesSectionProps) {
  const t = useTranslations('employer.profile.hiringPrefs');
  const prefs = profile.hiringPreferences;

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState({
    categories: prefs?.preferredCategories?.join(', ') ?? '',
    nationalities: prefs?.preferredNationalities?.join(', ') ?? '',
    minExperience: String(prefs?.minExperience ?? 0),
    notes: prefs?.notes ?? '',
  });

  const handleEdit = () => {
    setDraft({
      categories: prefs?.preferredCategories?.join(', ') ?? '',
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

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await patchHiringPreferences({
        preferredCategories: splitCSV(draft.categories),
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
    <p className="text-sm text-neutral-500">{t('emptyHint')}</p>
  ) : (
    <div className="flex flex-col gap-3">
      {(prefs?.preferredCategories?.length ?? 0) > 0 && (
        <div>
          <span className="text-xs text-neutral-500">{t('categoriesLabel')}</span>
          <ChipList items={prefs!.preferredCategories!} />
        </div>
      )}
      {(prefs?.preferredNationalities?.length ?? 0) > 0 && (
        <div>
          <span className="text-xs text-neutral-500">{t('nationalitiesLabel')}</span>
          <ChipList items={prefs!.preferredNationalities!} />
        </div>
      )}
      {(prefs?.minExperience ?? 0) > 0 && (
        <div>
          <span className="text-xs text-neutral-500">{t('minExperienceLabel')}</span>
          <p className="text-sm text-neutral-900">{prefs!.minExperience}+</p>
        </div>
      )}
      {prefs?.notes && (
        <div>
          <span className="text-xs text-neutral-500">{t('notesLabel')}</span>
          <p className="text-sm text-neutral-900 whitespace-pre-line">{prefs.notes}</p>
        </div>
      )}
    </div>
  );

  const editForm = (
    <div className="flex flex-col gap-4">
      <Field id="hp-categories" label={t('categoriesLabel')} hint={t('categoriesHint')}>
        <Input
          id="hp-categories"
          value={draft.categories}
          onChange={set('categories')}
          placeholder="e.g. Electrician, Plumber"
        />
      </Field>
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
          className="flex w-full rounded-md border border-input bg-background ps-3 pe-3 py-2 text-base text-foreground placeholder:text-neutral-400 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-primary-600 resize-y"
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
