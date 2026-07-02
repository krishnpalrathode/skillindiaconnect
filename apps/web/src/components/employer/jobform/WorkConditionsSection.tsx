'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { JobFormValues, JobFormErrors } from '@/lib/jobs/jobFormState';

interface WorkConditionsSectionProps {
  values: JobFormValues;
  errors: JobFormErrors;
  onChange: (
    patch: Partial<
      Pick<
        JobFormValues,
        'workConditions' | 'experienceRequiredYears' | 'vacancies' | 'genderPreference'
      >
    >,
  ) => void;
}

export function WorkConditionsSection({ values, errors, onChange }: WorkConditionsSectionProps) {
  const t = useTranslations('jobform.conditions');

  return (
    <section aria-labelledby="conditions-heading" className="flex flex-col gap-4">
      <div>
        <h3 id="conditions-heading" className="text-base font-semibold text-neutral-900">
          {t('heading')}
        </h3>
        <p className="mt-0.5 text-sm text-neutral-500">{t('subtitle')}</p>
      </div>

      <Field
        id="work-conditions"
        label={t('workConditionsLabel')}
        hint={t('workConditionsHint')}
        error={errors.workConditions}
      >
        <textarea
          id="work-conditions"
          rows={3}
          value={values.workConditions}
          onChange={(e) => onChange({ workConditions: e.target.value })}
          placeholder={t('workConditionsPlaceholder')}
          maxLength={500}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none resize-none focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-primary-600 ps-3 pe-3 min-h-[80px]"
          aria-describedby="work-conditions-hint"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field
          id="experience-years"
          label={t('experienceLabel')}
          hint={t('experienceHint')}
          error={errors.experienceRequiredYears}
        >
          <Input
            id="experience-years"
            type="number"
            min={0}
            max={30}
            step={1}
            value={values.experienceRequiredYears}
            onChange={(e) => onChange({ experienceRequiredYears: e.target.value })}
            placeholder="0"
            hasError={!!errors.experienceRequiredYears}
          />
        </Field>
        <Field
          id="vacancies"
          label={t('vacanciesLabel')}
          hint={t('vacanciesHint')}
          error={errors.vacancies}
        >
          <Input
            id="vacancies"
            type="number"
            min={1}
            max={999}
            step={1}
            value={values.vacancies}
            onChange={(e) => onChange({ vacancies: e.target.value })}
            placeholder="1"
            hasError={!!errors.vacancies}
          />
        </Field>
      </div>

      <Field id="gender-pref" label={t('genderPreferenceLabel')} hint={t('genderPreferenceHint')}>
        <select
          id="gender-pref"
          value={values.genderPreference}
          onChange={(e) =>
            onChange({ genderPreference: e.target.value as JobFormValues['genderPreference'] })
          }
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-primary-600 ps-3 pe-3"
        >
          <option value="ANY">{t('genderAny')}</option>
          <option value="MALE">{t('genderMale')}</option>
          <option value="FEMALE">{t('genderFemale')}</option>
        </select>
      </Field>
    </section>
  );
}
