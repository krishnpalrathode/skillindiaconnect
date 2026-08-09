'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Construction } from 'lucide-react';
import { apiFetchRaw, ApiRequestError } from '@/lib/api/client';
import { ForbiddenState } from './ForbiddenState';
import { BrandLoader } from '@/components/ui/brand-loader';

/**
 * A not-yet-built screen — but NOT an inert one.
 *
 * It calls the SAME endpoint the real screen will call. That is deliberate: the
 * point of the placeholder is to make the nav walkable end-to-end, and a route
 * that never talks to the server proves nothing about whether the caller is
 * allowed to be there. By probing the real endpoint we get, today, the exact
 * behaviour the finished screen must have:
 *
 *   - the caller holds the key  → the placeholder renders,
 *   - the caller does NOT       → the server 403s and ForbiddenState renders.
 *
 * So the forced-URL path (nav hidden, user types the address anyway) is exercised
 * on every route from this unit onwards, instead of being something each future
 * screen has to remember to handle. When F2/F3/S6b replace these bodies, the 403
 * branch is already there and already tested.
 */
export function AdminPlaceholder({
  titleKey,
  unit,
  probePath,
}: {
  /** i18n key under `admin.nav.*`. */
  titleKey: string;
  /** Which unit builds this screen — so a walker knows it is pending, not broken. */
  unit: string;
  /** The endpoint the real screen will read. Probed to surface the server's verdict. */
  probePath: string;
}) {
  const t = useTranslations('admin');
  const [state, setState] = useState<'loading' | 'ok' | 'forbidden' | 'error'>('loading');
  const [requiredPermission, setRequiredPermission] = useState<string | undefined>();

  const probe = useCallback(async () => {
    setState('loading');
    try {
      await apiFetchRaw<unknown>(probePath);
      setState('ok');
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.status === 403) {
        setRequiredPermission(err.error.meta?.['requiredPermission'] as string | undefined);
        setState('forbidden');
        return;
      }
      // A placeholder must not cry wolf about a backend that isn't built yet:
      // anything other than a 403 still shows the placeholder, because "this
      // screen is coming in F2" is the honest message, not "something broke".
      setState('error');
    }
  }, [probePath]);

  useEffect(() => {
    void probe();
  }, [probe]);

  if (state === 'loading') {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <BrandLoader size="md" label={t('loading')} />
      </div>
    );
  }

  if (state === 'forbidden') {
    return <ForbiddenState requiredPermission={requiredPermission} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-neutral-900">{t(`nav.${titleKey}`)}</h1>
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-neutral-300 bg-white p-6">
        <Construction className="size-6 shrink-0 text-neutral-600" aria-hidden="true" />
        <p className="text-sm text-neutral-600">{t('placeholder', { unit })}</p>
      </div>
    </div>
  );
}
