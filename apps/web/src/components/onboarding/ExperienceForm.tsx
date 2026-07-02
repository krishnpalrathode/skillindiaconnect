'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { postExperience, patchExperience } from '@/lib/api/candidate';
import type { CreateExperienceBody } from '@/lib/api/candidate';

type WorkExperience = components['schemas']['WorkExperience'];
type ExperienceType = components['schemas']['ExperienceType'];

interface ExperienceFormProps {
  existing?: WorkExperience;
  onSaved: (exp: WorkExperience) => void;
  onCancel: () => void;
}

/**
 * Inline form for adding or editing a single work experience entry.
 * Calls POST /experiences (new) or PATCH /experiences/:id (edit).
 */
export function ExperienceForm({ existing, onSaved, onCancel }: ExperienceFormProps) {
  const t = useTranslations('onboarding.experience');

  const [type, setType] = useState<ExperienceType>(existing?.type ?? 'INDIA');
  const [country, setCountry] = useState(existing?.country ?? '');
  const [company, setCompany] = useState(existing?.companyName ?? '');
  const [role, setRole] = useState(existing?.role ?? '');
  const [years, setYears] = useState(String(existing?.years ?? ''));
  const [months, setMonths] = useState(String(existing?.months ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const body: CreateExperienceBody = {
      type,
      ...(country.trim() ? { country: country.trim() } : {}),
      ...(company.trim() ? { companyName: company.trim() } : {}),
      ...(role.trim() ? { role: role.trim() } : {}),
      ...(years ? { years: Number(years) } : {}),
      ...(months ? { months: Number(months) } : {}),
    };

    try {
      const exp = existing ? await patchExperience(existing.id, body) : await postExperience(body);
      onSaved(exp);
    } catch {
      setError('Failed to save experience. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 p-4 rounded-lg border border-border bg-neutral-50"
    >
      {/* Experience type toggle */}
      <div>
        <p className="text-sm font-medium text-neutral-700 mb-2">{t('typeLabel')}</p>
        <div className="flex rounded-md border border-border overflow-hidden text-sm">
          {(['INDIA', 'FOREIGN'] as ExperienceType[]).map((opt) => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={type === opt}
              onClick={() => setType(opt)}
              className={[
                'flex-1 py-2 font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
                type === opt
                  ? 'bg-primary-50 text-primary-700 border-b-2 border-primary-600'
                  : 'text-neutral-600 hover:bg-neutral-50',
              ].join(' ')}
            >
              {opt === 'INDIA' ? t('typeDomestic') : t('typeForeign')}
            </button>
          ))}
        </div>
      </div>

      {/* Country (only for FOREIGN) */}
      {type === 'FOREIGN' && (
        <Field id="exp-country" label={t('countryLabel')}>
          <Input
            placeholder="UAE, Saudi Arabia…"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          />
        </Field>
      )}

      <Field id="exp-company" label={t('companyLabel')}>
        <Input
          placeholder="Company name"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
      </Field>

      <Field id="exp-role" label={t('roleLabel')}>
        <Input
          placeholder="Mason, Driver, Welder…"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        />
      </Field>

      <div className="flex gap-3">
        <Field id="exp-years" label={t('yearsLabel')} className="flex-1">
          <Input
            type="number"
            min={0}
            max={50}
            placeholder="0"
            value={years}
            onChange={(e) => setYears(e.target.value)}
          />
        </Field>
        <Field id="exp-months" label={t('monthsLabel')} className="flex-1">
          <Input
            type="number"
            min={0}
            max={11}
            placeholder="0"
            value={months}
            onChange={(e) => setMonths(e.target.value)}
          />
        </Field>
      </div>

      {error && (
        <p role="alert" className="text-xs text-error-fg">
          {error}
        </p>
      )}

      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          {t('cancel')}
        </Button>
        <Button type="submit" variant="secondary" size="sm" loading={saving}>
          {t('saveExperience')}
        </Button>
      </div>
    </form>
  );
}
