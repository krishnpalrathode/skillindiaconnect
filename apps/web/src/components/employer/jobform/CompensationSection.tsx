'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  getCurrenciesForMarket,
  type JobFormValues,
  type JobFormErrors,
} from '@/lib/jobs/jobFormState';

interface CompensationSectionProps {
  values: JobFormValues;
  errors: JobFormErrors;
  onChange: (
    patch: Partial<Pick<JobFormValues, 'salaryMin' | 'salaryMax' | 'salaryCurrency'>>,
  ) => void;
}

export function CompensationSection({ values, errors, onChange }: CompensationSectionProps) {
  const t = useTranslations('jobform.compensation');
  const currencies = getCurrenciesForMarket(values.market);

  // When market changes (parent controls market), ensure currency is valid
  const currency = currencies.includes(values.salaryCurrency)
    ? values.salaryCurrency
    : currencies[0]!;

  return (
    <section aria-labelledby="compensation-heading" className="flex flex-col gap-4">
      <div>
        <h3 id="compensation-heading" className="text-base font-semibold text-neutral-900">
          {t('heading')}
        </h3>
        <p className="mt-0.5 text-sm text-neutral-500">{t('subtitle')}</p>
      </div>

      {/* Currency selector */}
      <Field id="salary-currency" label={t('currencyLabel')} required error={errors.salaryCurrency}>
        <select
          id="salary-currency"
          value={currency}
          onChange={(e) => onChange({ salaryCurrency: e.target.value })}
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-primary-600 ps-3 pe-3"
          aria-required
        >
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>

      {/* Salary range */}
      <div className="grid grid-cols-2 gap-3">
        <Field id="salary-min" label={t('salaryMinLabel')} error={errors.salaryMin}>
          <Input
            id="salary-min"
            type="number"
            min={0}
            step={100}
            value={values.salaryMin}
            onChange={(e) => onChange({ salaryMin: e.target.value })}
            placeholder={t('salaryMinPlaceholder')}
            hasError={!!errors.salaryMin}
          />
        </Field>
        <Field id="salary-max" label={t('salaryMaxLabel')} error={errors.salaryMax}>
          <Input
            id="salary-max"
            type="number"
            min={0}
            step={100}
            value={values.salaryMax}
            onChange={(e) => onChange({ salaryMax: e.target.value })}
            placeholder={t('salaryMaxPlaceholder')}
            hasError={!!errors.salaryMax}
          />
        </Field>
      </div>
      <p className="text-xs text-neutral-400">{t('salaryHint', { currency })}</p>
    </section>
  );
}
