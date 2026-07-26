'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Lock, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JobFormValues } from '@/lib/jobs/jobFormState';

interface BenefitsSectionProps {
  values: JobFormValues;
  onChange: (
    patch: Partial<Pick<JobFormValues, 'foodAllowance' | 'airTickets' | 'otherAllowance'>>,
  ) => void;
}

function LockedToggle({ label, description }: { label: string; description: string }) {
  return (
    <div
      className="flex items-start gap-3 rounded-xl border border-success-fg/25 bg-success-bg/25 p-3.5"
      role="group"
      aria-label={label}
    >
      <div
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-success-fg/20"
        aria-hidden="true"
      >
        <Lock className="size-3 text-success-fg" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-neutral-900">{label}</span>
          <span
            role="img"
            aria-label="Required — locked on by platform policy"
            className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success-fg border border-success-fg/30"
          >
            <ShieldCheck className="size-3" aria-hidden="true" />
            Required
          </span>
        </div>
        <p className="mt-0.5 text-xs text-neutral-600">{description}</p>
      </div>
      {/* Visually shows locked-on state; aria-disabled + aria-checked convey it to SR */}
      <div
        role="checkbox"
        aria-checked="true"
        aria-disabled="true"
        aria-label={`${label} — required by platform policy, cannot be turned off`}
        tabIndex={-1}
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-success-fg bg-success-fg cursor-not-allowed"
      >
        <svg className="size-3 text-white" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M2 6l3 3 5-5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

function OptionalToggle({
  label,
  description,
  checked,
  onToggle,
  id,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onToggle: () => void;
  id: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-3.5 cursor-pointer transition-all hover:border-[#0F3D91]/40 hover:bg-[#E8F0FE]/40 hover:shadow-sm"
    >
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-neutral-900 block">{label}</span>
        {description && <span className="text-xs text-neutral-600">{description}</span>}
      </div>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-0.5 size-4 accent-primary-600 cursor-pointer"
      />
    </label>
  );
}

export function BenefitsSection({ values, onChange }: BenefitsSectionProps) {
  const t = useTranslations('jobform.benefits');

  return (
    <section aria-labelledby="benefits-heading" className="flex flex-col gap-4">
      <div className="flex items-start gap-3 border-b border-neutral-100 pb-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-sm font-bold text-[#0F3D91]"
        >
          4
        </span>
        <div>
          <h3 id="benefits-heading" className="text-base font-bold text-neutral-900">
            {t('heading')}
          </h3>
          <p className="mt-0.5 text-sm text-neutral-600">{t('subtitle')}</p>
        </div>
      </div>

      {/* Policy banner */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-xl border border-[#0F3D91]/15 bg-gradient-to-br from-[#E8F0FE]/70 to-white p-4 shadow-sm"
      >
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#0F3D91] text-white">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold text-neutral-900">{t('policyTitle')}</p>
          <p className="mt-0.5 text-xs text-neutral-600">{t('policyBody')}</p>
        </div>
      </div>

      {/* Mandatory locked benefits */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
          {t('mandatoryLabel')}
        </p>
        <LockedToggle label={t('accommodation')} description={t('accommodationHint')} />
        <LockedToggle label={t('healthInsurance')} description={t('healthInsuranceHint')} />
        <LockedToggle label={t('transportation')} description={t('transportationHint')} />
      </div>

      {/* Optional benefits */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
          {t('optionalLabel')}
        </p>
        <OptionalToggle
          id="benefit-food"
          label={t('foodAllowance')}
          checked={values.foodAllowance}
          onToggle={() => onChange({ foodAllowance: !values.foodAllowance })}
        />
        <OptionalToggle
          id="benefit-air-tickets"
          label={t('airTickets')}
          checked={values.airTickets}
          onToggle={() => onChange({ airTickets: !values.airTickets })}
        />
        <div className="rounded-lg border border-neutral-200 bg-white p-3 flex flex-col gap-2">
          <label htmlFor="benefit-other" className={cn('text-sm font-medium text-neutral-900')}>
            {t('otherAllowance')}
            <span className="ms-1 text-xs font-normal text-neutral-600">({t('optional')})</span>
          </label>
          <input
            id="benefit-other"
            type="text"
            value={values.otherAllowance}
            onChange={(e) => onChange({ otherAllowance: e.target.value })}
            placeholder={t('otherAllowancePlaceholder')}
            maxLength={200}
            className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-primary-600 ps-3 pe-3"
          />
        </div>
      </div>
    </section>
  );
}
