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
        | 'hoursPerDay'
        | 'daysPerWeek'
        | 'overtime'
        | 'experienceRequiredYears'
        | 'vacancies'
        | 'genderPreference'
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

      {/* Structured working hours — map to hoursPerDay / daysPerWeek columns */}
      <div className="grid grid-cols-2 gap-3">
        <Field id="hours-per-day" label="Hours per day" required error={errors.hoursPerDay}>
          <Input
            id="hours-per-day"
            type="number"
            min={1}
            max={24}
            step={1}
            value={values.hoursPerDay}
            onChange={(e) => onChange({ hoursPerDay: e.target.value })}
            placeholder="8"
            hasError={!!errors.hoursPerDay}
            aria-required
          />
        </Field>
        <Field id="days-per-week" label="Days per week" required error={errors.daysPerWeek}>
          <Input
            id="days-per-week"
            type="number"
            min={1}
            max={7}
            step={1}
            value={values.daysPerWeek}
            onChange={(e) => onChange({ daysPerWeek: e.target.value })}
            placeholder="6"
            hasError={!!errors.daysPerWeek}
            aria-required
          />
        </Field>
      </div>

      <label
        htmlFor="overtime"
        className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 transition-colors"
      >
        <input
          id="overtime"
          type="checkbox"
          checked={values.overtime}
          onChange={() => onChange({ overtime: !values.overtime })}
          className="size-4 accent-primary-600 cursor-pointer"
        />
        <span className="text-sm font-medium text-neutral-900">Overtime available</span>
      </label>

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
