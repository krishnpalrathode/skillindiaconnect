'use client';

import React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatSubunits } from '@/lib/money';

type Plan = components['schemas']['Plan'];

interface PlanCardProps {
  plan: Plan;
  /** LOCAL companies see the GST line + indicative gross; FOREIGN see base only. */
  isLocal: boolean;
  /** The company's current plan → "Current plan" chip; Free is never purchasable. */
  isCurrent: boolean;
  /** Pre-emphasized (the ?upgrade=quota entry highlights Pro). */
  emphasized?: boolean;
  /** Radio-group selection state. */
  selected: boolean;
  onSelect: () => void;
  /** Launch checkout for this plan (absent for FREE / current). */
  onUpgrade?: () => void;
}

/**
 * A single plan card, rendered as a radio option inside PlanCards' radiogroup.
 *
 * Money is ALWAYS formatted from integer subunits via money.ts — never computed
 * here. The GST line uses the plan's `gstRatePct` DISPLAY HINT and is clearly
 * labelled indicative; the authoritative split arrives on the checkout response.
 * FREE is never purchasable — its footer is a "Current plan" state, never a
 * checkout button.
 */
export function PlanCard({
  plan,
  isLocal,
  isCurrent,
  emphasized,
  selected,
  onSelect,
  onUpgrade,
}: PlanCardProps) {
  const t = useTranslations('billing');
  const locale = useLocale();

  const isFree = plan.code === 'FREE';
  const isPurchasable = !isFree;
  const isYearly = plan.code === 'PRO_YEARLY';

  // Indicative gross for LOCAL display only — the checkout response owns the
  // real split. gstRatePct is a hint; we never treat this as authoritative.
  const gstRatePct = plan.gstRatePct ?? 18;
  const indicativeGross = plan.priceSubunits + Math.round((plan.priceSubunits * gstRatePct) / 100);

  return (
    <Card
      role="radio"
      aria-checked={selected}
      aria-label={plan.name}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'relative cursor-pointer transition-shadow focus-visible:outline-none',
        'focus-visible:ring-[3px] focus-visible:ring-ring/70',
        selected ? 'border-primary-600 ring-1 ring-primary-600' : 'hover:shadow-md',
        emphasized && !selected && 'border-primary-300',
      )}
    >
      {isYearly && (
        <div className="absolute end-3 top-3">
          <Badge variant="success">{t('bestValue')}</Badge>
        </div>
      )}

      <div className="flex flex-col gap-1 ps-4 pe-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-neutral-900">{plan.name}</h3>
          {isCurrent && <Badge variant="neutral">{t('currentPlan')}</Badge>}
        </div>

        {/* Price block — all figures from subunits, never computed */}
        <div className="mt-1">
          <span className="text-2xl font-bold text-neutral-900">
            {formatSubunits(plan.priceSubunits, plan.currency, locale)}
          </span>
          {plan.period && (
            <span className="text-sm text-neutral-600 ms-1">
              {plan.period === 'YEARLY' ? t('perYear') : t('perMonth')}
            </span>
          )}
        </div>

        {/* GST display is company-type-aware: LOCAL only, and clearly indicative */}
        {isPurchasable && isLocal && (
          <p className="text-xs text-neutral-600">
            {t('gstIndicative', {
              rate: gstRatePct,
              gross: formatSubunits(indicativeGross, plan.currency, locale),
            })}
          </p>
        )}
      </div>

      <div className="ps-4 pe-4 pb-4 flex-1">
        <ul className="flex flex-col gap-1.5 mt-1">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-sm text-neutral-700">
              <Check className="size-4 text-success-fg shrink-0 mt-0.5" aria-hidden="true" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="ps-4 pe-4 pt-3 pb-4 border-t border-neutral-200 bg-neutral-50">
        {isFree ? (
          <p className="text-sm text-neutral-600 text-center">
            {isCurrent ? t('yourCurrentPlan') : t('freeForever')}
          </p>
        ) : isCurrent ? (
          <p className="text-sm text-neutral-600 text-center">{t('yourCurrentPlan')}</p>
        ) : (
          <Button
            variant={emphasized ? 'primary' : 'secondary'}
            size="md"
            className="w-full"
            onClick={(e) => {
              e.stopPropagation();
              onUpgrade?.();
            }}
          >
            {t('upgradeCta', { plan: plan.name })}
          </Button>
        )}
      </div>
    </Card>
  );
}
