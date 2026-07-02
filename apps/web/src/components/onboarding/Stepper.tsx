'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StepIndex = 1 | 2 | 3 | 4;

interface StepperProps {
  current: StepIndex;
  className?: string;
}

const STEP_KEYS = ['personalInfo', 'workExperience', 'documentsSkills', 'preview'] as const;

/**
 * 4-step horizontal progress indicator.
 * RTL-aware: uses logical CSS so the connector line flips direction with dir="rtl".
 */
export function Stepper({ current, className }: StepperProps) {
  const t = useTranslations('onboarding.steps');

  return (
    <nav aria-label={`Step ${current} of ${STEP_KEYS.length}`} className={className}>
      <ol className="flex items-center w-full">
        {STEP_KEYS.map((key, idx) => {
          const stepNum = (idx + 1) as StepIndex;
          const done = current > stepNum;
          const active = current === stepNum;
          const isLast = idx === STEP_KEYS.length - 1;

          return (
            <li
              key={key}
              className={cn('flex items-center', !isLast && 'flex-1')}
              aria-current={active ? 'step' : undefined}
            >
              {/* Step circle */}
              <div className="flex flex-col items-center gap-1 min-w-0">
                <div
                  className={cn(
                    'flex items-center justify-center rounded-full shrink-0',
                    'w-8 h-8 text-sm font-semibold transition-colors',
                    done && 'bg-primary-600 text-white',
                    active && 'bg-accent-500 text-neutral-900 ring-2 ring-accent-300',
                    !done && !active && 'bg-neutral-200 text-neutral-500',
                  )}
                  aria-hidden="true"
                >
                  {done ? <Check className="size-4" /> : stepNum}
                </div>
                <span
                  className={cn(
                    'hidden sm:block text-xs font-medium text-center leading-tight max-w-[72px] truncate',
                    active ? 'text-accent-700' : done ? 'text-primary-600' : 'text-neutral-400',
                  )}
                >
                  {t(key)}
                </span>
              </div>

              {/* Connector line */}
              {!isLast && (
                <div
                  aria-hidden="true"
                  className={cn(
                    'flex-1 h-0.5 mx-2 transition-colors',
                    done ? 'bg-primary-600' : 'bg-neutral-200',
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
