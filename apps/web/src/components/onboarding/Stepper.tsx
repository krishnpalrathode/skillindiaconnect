'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Check, User, Briefcase, FileText, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StepIndex = 1 | 2 | 3 | 4;

interface StepperProps {
  current: StepIndex;
  className?: string;
}

const STEP_KEYS = ['personalInfo', 'workExperience', 'documentsSkills', 'preview'] as const;

const STEP_ICONS: Record<(typeof STEP_KEYS)[number], React.ReactNode> = {
  personalInfo: <User className="size-3.5" aria-hidden="true" />,
  workExperience: <Briefcase className="size-3.5" aria-hidden="true" />,
  documentsSkills: <FileText className="size-3.5" aria-hidden="true" />,
  preview: <Eye className="size-3.5" aria-hidden="true" />,
};

/**
 * 4-step horizontal progress indicator.
 * RTL-aware: uses logical CSS so the connector line flips direction with dir="rtl".
 */
export function Stepper({ current, className }: StepperProps) {
  const t = useTranslations('onboarding.steps');

  return (
    <nav aria-label={`Step ${current} of ${STEP_KEYS.length}`} className={className}>
      <ol className="flex w-full items-start">
        {STEP_KEYS.map((key, idx) => {
          const stepNum = (idx + 1) as StepIndex;
          const done = current > stepNum;
          const active = current === stepNum;
          const isLast = idx === STEP_KEYS.length - 1;

          return (
            <li
              key={key}
              className={cn('flex items-start', !isLast && 'flex-1')}
              aria-current={active ? 'step' : undefined}
            >
              {/* Step circle */}
              <div className="flex min-w-0 flex-col items-center gap-1.5">
                <div
                  className={cn(
                    'flex shrink-0 items-center justify-center rounded-full',
                    'size-11 text-base font-bold transition-all duration-300',
                    done && 'bg-success text-white shadow-md',
                    active &&
                      'bg-gradient-to-br from-[#0F3D91] to-[#2E67B1] text-white shadow-lg shadow-[#0F3D91]/30 ring-4 ring-[#E8F0FE] scale-105',
                    !done && !active && 'border-2 border-neutral-200 bg-white text-neutral-600',
                  )}
                  aria-hidden="true"
                >
                  {done ? <Check className="size-5" /> : stepNum}
                </div>
                <span
                  className={cn(
                    'hidden max-w-[84px] items-center gap-1 sm:flex',
                    'text-xs font-semibold leading-tight',
                    active ? 'text-[#0F3D91]' : done ? 'text-success-fg' : 'text-neutral-600',
                  )}
                >
                  <span className="shrink-0" aria-hidden="true">
                    {STEP_ICONS[key]}
                  </span>
                  <span className="truncate">{t(key)}</span>
                </span>
              </div>

              {/* Connector line */}
              {!isLast && (
                <div
                  aria-hidden="true"
                  className={cn(
                    'mx-2 mt-5 h-1 flex-1 rounded-full transition-colors duration-500',
                    done ? 'bg-success' : 'bg-neutral-200',
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
