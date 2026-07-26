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
      country: type === 'INDIA' ? 'India' : country.trim(),
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
      className="flex flex-col gap-4 rounded-[22px] border border-neutral-200/70 bg-gradient-to-br from-neutral-50 to-[#E8F0FE]/30 p-5 shadow-sm"
    >
      {/* Experience type toggle */}
      <div>
        <p className="mb-2 text-sm font-medium text-neutral-700">{t('typeLabel')}</p>
        <div className="flex gap-1 rounded-xl bg-neutral-100 p-1 text-sm">
          {(['INDIA', 'FOREIGN'] as ExperienceType[]).map((opt) => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={type === opt}
              onClick={() => setType(opt)}
              className={[
                'flex-1 rounded-lg py-2 font-semibold transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
                type === opt
                  ? 'bg-white text-[#0F3D91] shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-900',
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
            className="h-12 rounded-xl bg-white"
            placeholder="UAE, Saudi Arabia…"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          />
        </Field>
      )}

      <Field id="exp-company" label={t('companyLabel')}>
        <Input
          className="h-12 rounded-xl bg-white"
          placeholder="Company name"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
      </Field>

      <Field id="exp-role" label={t('roleLabel')}>
        <Input
          className="h-12 rounded-xl bg-white"
          placeholder="Mason, Driver, Welder…"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        />
      </Field>

      <div className="flex gap-3">
        <Field id="exp-years" label={t('yearsLabel')} className="flex-1">
          <Input
            className="h-12 rounded-xl bg-white"
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
            className="h-12 rounded-xl bg-white"
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

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={saving}
          className="min-h-10 rounded-xl px-4"
        >
          {t('cancel')}
        </Button>
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          loading={saving}
          className="min-h-10 rounded-xl bg-gradient-to-r from-[#0F3D91] to-[#2E67B1] px-5 text-white shadow-sm transition-all hover:shadow-md"
        >
          {t('saveExperience')}
        </Button>
      </div>
    </form>
  );
}
