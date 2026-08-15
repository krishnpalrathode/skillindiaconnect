'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getAdminPlans, updatePlanPrice, type AdminPlan } from '@/lib/api/admin-settings';
import { ApiRequestError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

/**
 * Plan pricing, inside Screen 28's Payments tab.
 *
 * Sits beside the GST rate because the two are the same job: the numbers that
 * decide what an employer is charged. Before this, a price change meant editing
 * the seed and shipping a deploy.
 *
 * ── Rupees in, paise out ────────────────────────────────────────────────────
 * The API stores INTEGER SUBUNITS. Admins think in rupees, so the conversion
 * happens once, here, with `Math.round` — never by letting a float travel. The
 * input is `inputMode="decimal"` rather than `type="number"` so a stray scroll
 * over the field cannot nudge a price.
 */

/** ₹2,999.00 ⇄ 299900 paise. */
function toRupees(subunits: number): string {
  return (subunits / 100).toFixed(2);
}
function toSubunits(rupees: string): number | null {
  const n = Number(rupees.replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  // Round at the boundary: 2999.995 * 100 is 299999.49999 in binary floating
  // point, and truncating would quietly bill a paisa less.
  return Math.round(n * 100);
}

function PlanRow({ plan, onSaved }: { plan: AdminPlan; onSaved: (updated: AdminPlan) => void }) {
  const t = useTranslations('admin.settings.plans');
  const [draft, setDraft] = useState(() => toRupees(plan.priceSubunits));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Adopt the server's value whenever it changes underneath us (another admin,
  // or our own successful save).
  useEffect(() => {
    setDraft(toRupees(plan.priceSubunits));
  }, [plan.priceSubunits]);

  const parsed = toSubunits(draft);
  const dirty = parsed !== null && parsed !== plan.priceSubunits;

  async function save() {
    if (parsed === null) {
      setError(t('invalid'));
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updatePlanPrice(plan.code, parsed);
      onSaved(updated);
      setSaved(true);
    } catch (err) {
      /*
        Surface the SERVER's wording. The two structural refusals
        (FREE_PLAN_NOT_PRICEABLE / PAID_PLAN_NEEDS_PRICE) explain a rule the
        admin cannot infer from the form, so replacing them with a generic
        "couldn't save" would hide the only useful part of the response.
      */
      setError(err instanceof ApiRequestError ? err.error.detail : t('saveFailed'));
      setDraft(toRupees(plan.priceSubunits));
    } finally {
      setSaving(false);
    }
  }

  const inputId = `plan-price-${plan.code}`;

  return (
    <div className="flex flex-col gap-2 border-b border-neutral-100 py-4 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <label htmlFor={inputId} className="text-sm font-medium text-neutral-900">
              {plan.name}
            </label>
            {!plan.isActive && <Badge variant="warning">{t('inactive')}</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-neutral-600">
            {plan.period ? t(`period.${plan.period}`) : t('period.none')}
            {' · '}
            {plan.maxActiveJobs === null
              ? t('unlimitedJobs')
              : t('maxJobs', { count: plan.maxActiveJobs })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-600" aria-hidden="true">
            ₹
          </span>
          <Input
            id={inputId}
            // Not type=number: a scroll wheel over a focused number input
            // changes its value, and this one is a price.
            inputMode="decimal"
            value={draft}
            disabled={!plan.priceEditable || saving}
            aria-invalid={!!error}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
              setSaved(false);
            }}
            className="h-10 w-32 text-end tabular-nums"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!plan.priceEditable || !dirty || saving}
            loading={saving}
            onClick={() => void save()}
          >
            {t('save')}
          </Button>
        </div>
      </div>

      {!plan.priceEditable && <p className="text-xs text-neutral-600">{t('freeLocked')}</p>}
      {error && (
        <p role="alert" className="text-xs text-error-fg">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="text-xs text-success-fg">
          {t('savedNote')}
        </p>
      )}
    </div>
  );
}

export function PlanPricingPanel() {
  const t = useTranslations('admin.settings.plans');
  const [plans, setPlans] = useState<AdminPlan[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPlans(await getAdminPlans());
    } catch (err) {
      setError(err as Error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 py-6">
        <p className="text-sm font-medium text-error-fg">{t('loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (!plans) {
    return <Skeleton className="my-4 h-40 w-full rounded-xl" aria-busy="true" />;
  }

  return (
    <section aria-labelledby="plan-pricing-heading" className="py-2">
      <h3 id="plan-pricing-heading" className="text-sm font-semibold text-neutral-900">
        {t('heading')}
      </h3>
      {/* States the blast radius up front: what changes, and what provably does
          not. An admin editing a price needs to know invoices are untouched. */}
      <p className="mb-1 mt-0.5 text-xs text-neutral-600">{t('subheading')}</p>

      {plans.map((plan) => (
        <PlanRow
          key={plan.code}
          plan={plan}
          onSaved={(updated) =>
            setPlans((prev) => (prev ?? []).map((p) => (p.code === updated.code ? updated : p)))
          }
        />
      ))}
    </section>
  );
}
