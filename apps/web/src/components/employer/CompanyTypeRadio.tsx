'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Building2, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { components } from '@skillindiaconnect/shared-types';

type CompanyType = components['schemas']['CompanyType'];

interface CompanyTypeRadioProps {
  value: CompanyType | '';
  onChange: (value: CompanyType) => void;
  error?: string;
}

/**
 * Load-bearing radio group: LOCAL vs FOREIGN.
 * This choice drives payment routing (Razorpay/Stripe, S5), benefit display,
 * and currency — it is set ONCE at onboarding and cannot be changed after approval.
 */
export function CompanyTypeRadio({ value, onChange, error }: CompanyTypeRadioProps) {
  const t = useTranslations('employer.onboarding');
  const errorId = error ? 'company-type-error' : undefined;

  const options: {
    type: CompanyType;
    icon: React.ReactNode;
    title: string;
    description: string;
  }[] = [
    {
      type: 'LOCAL',
      icon: <Building2 className="size-5" aria-hidden="true" />,
      title: t('localTitle'),
      description: t('localDescription'),
    },
    {
      type: 'FOREIGN',
      icon: <Globe className="size-5" aria-hidden="true" />,
      title: t('foreignTitle'),
      description: t('foreignDescription'),
    },
  ];

  return (
    <fieldset
      aria-required="true"
      aria-invalid={error ? true : undefined}
      aria-describedby={errorId}
    >
      <legend className="text-sm font-medium text-neutral-700 mb-2">
        {t('companyTypeLabel')}
        <span className="ms-1 text-error-fg" aria-hidden="true">
          *
        </span>
      </legend>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup">
        {options.map(({ type, icon, title, description }) => (
          <label
            key={type}
            className={cn(
              'relative flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all',
              'focus-within:ring-[3px] focus-within:ring-ring/70',
              'min-h-[44px]',
              value === type
                ? 'border-primary-500 bg-primary-50'
                : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50',
              error && value !== type && 'border-error/40',
            )}
          >
            <input
              type="radio"
              name="companyType"
              value={type}
              checked={value === type}
              onChange={() => onChange(type)}
              className="mt-0.5 size-4 text-primary-600 border-neutral-300 focus:ring-primary-500 shrink-0"
              aria-label={title}
            />
            <span
              className={cn(
                'size-8 rounded-lg flex items-center justify-center shrink-0',
                value === type
                  ? 'bg-primary-100 text-primary-700'
                  : 'bg-neutral-100 text-neutral-500',
              )}
            >
              {icon}
            </span>
            <div className="min-w-0">
              <p
                className={cn(
                  'text-sm font-semibold',
                  value === type ? 'text-primary-900' : 'text-neutral-800',
                )}
              >
                {title}
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">{description}</p>
            </div>
          </label>
        ))}
      </div>

      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-error-fg font-medium">
          {error}
        </p>
      )}
    </fieldset>
  );
}
