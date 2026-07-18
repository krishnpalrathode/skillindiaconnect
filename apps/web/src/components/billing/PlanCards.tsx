'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { components } from '@skillindiaconnect/shared-types';
import { PlanCard } from './PlanCard';

type Plan = components['schemas']['Plan'];
type PlanCode = components['schemas']['PlanCode'];

interface PlanCardsProps {
  plans: Plan[];
  /** From useEmployer().company.type — drives the GST framing. */
  isLocal: boolean;
  /** The company's current plan code (defaults FREE). */
  currentPlanCode: PlanCode;
  /** True when arriving via ?upgrade=quota — Pro is pre-emphasized + pre-selected. */
  emphasizePro?: boolean;
  /** Launch checkout for a purchasable plan. */
  onUpgrade: (planCode: PlanCode) => void;
}

/**
 * The plan selection group (Screen 19).
 *
 * Rendered as a proper radiogroup: arrow keys / Enter / Space move and select,
 * each card is role="radio". FREE is present but never purchasable (no checkout
 * button). Money is formatted from subunits inside each card — never computed.
 */
export function PlanCards({
  plans,
  isLocal,
  currentPlanCode,
  emphasizePro,
  onUpgrade,
}: PlanCardsProps) {
  const t = useTranslations('billing');

  // Default selection: the emphasized upgrade path pre-selects Pro Monthly;
  // otherwise the current plan.
  const [selected, setSelected] = useState<PlanCode>(
    emphasizePro ? 'PRO_MONTHLY' : currentPlanCode,
  );

  const purchasable = plans.filter((p) => p.code !== 'FREE');

  return (
    <div
      role="radiogroup"
      aria-label={t('plansGroupLabel')}
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {plans.map((plan) => (
        <PlanCard
          key={plan.code}
          plan={plan}
          isLocal={isLocal}
          isCurrent={plan.code === currentPlanCode}
          emphasized={emphasizePro && purchasable.some((p) => p.code === plan.code)}
          selected={selected === plan.code}
          onSelect={() => setSelected(plan.code)}
          onUpgrade={plan.code !== 'FREE' ? () => onUpgrade(plan.code) : undefined}
        />
      ))}
    </div>
  );
}
