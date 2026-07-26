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
      <div className="flex items-start gap-3 border-b border-neutral-100 pb-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-sm font-bold text-[#0F3D91]"
        >
          3
        </span>
        <div>
          <h3 id="compensation-heading" className="text-base font-bold text-neutral-900">
            {t('heading')}
          </h3>
          <p className="mt-0.5 text-sm text-neutral-600">{t('subtitle')}</p>
        </div>
      </div>

      {/* Currency selector */}
      <Field id="salary-currency" label={t('currencyLabel')} required error={errors.salaryCurrency}>
        <select
          id="salary-currency"
          value={currency}
          onChange={(e) => onChange({ salaryCurrency: e.target.value })}
          className="flex h-12 w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-[#0F3D91] ps-3.5 pe-3.5"
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
      <p className="text-xs text-neutral-600">{t('salaryHint', { currency })}</p>
    </section>
  );
}
