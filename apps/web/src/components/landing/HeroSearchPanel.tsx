'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Search, Briefcase, Users, MapPin } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';

/**
 * Mobile-only tabbed search panel: "Find a Job" / "Hire Talent".
 *
 * - It is a REAL WAI-ARIA tablist (roles, aria-selected, aria-controls, roving
 *   tabindex, Arrow/Home/End keys), not styled divs.
 * - The Find-a-Job panel is a native `<form method="get" action="/{locale}/jobs">`
 *   so it works with NO JavaScript and routes into the EXISTING public job search
 *   using its real params (`q`, `market`). No parallel search is built.
 * - Hire-Talent routes to the existing employer signup.
 * - Popular searches deep-link into the same `/jobs` search filtered by category
 *   slug (real seed categories only).
 *
 * Rendered only below `lg` (the page wraps it in `lg:hidden`); desktop is
 * unchanged. The markup is server-rendered (SSR) and hydrated for interaction.
 */
const TABS = [
  { id: 'find', Icon: Briefcase },
  { id: 'hire', Icon: Users },
] as const;
type TabId = (typeof TABS)[number]['id'];

// Real seed job-category slugs (public /jobs?category=<slug>). The mockup listed
// Construction/Hospitality/Caregiver, which are not seed categories — substituted
// with Mason/Carpenter/Helper (stated in the delivery notes).
const CHIPS = [
  'driver',
  'electrician',
  'plumber',
  'welder',
  'mason',
  'carpenter',
  'helper',
] as const;

export function HeroSearchPanel({ locale }: { locale: string }) {
  const t = useTranslations('landing.search');
  const [active, setActive] = useState<TabId>('find');
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ find: null, hire: null });

  function onTabKeyDown(e: React.KeyboardEvent) {
    const order: TabId[] = TABS.map((tb) => tb.id);
    const i = order.indexOf(active);
    const n = order.length;
    let next: TabId | null = null;
    // The computed indices are always in range, so the lookups cannot be
    // undefined (noUncheckedIndexedAccess needs the assertion to see that).
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = order[(i + 1) % n]!;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = order[(i - 1 + n) % n]!;
    else if (e.key === 'Home') next = order[0]!;
    else if (e.key === 'End') next = order[n - 1]!;
    if (next) {
      e.preventDefault();
      setActive(next);
      tabRefs.current[next]?.focus();
    }
  }

  return (
    <section aria-label={t('tablistLabel')} className="bg-white px-4 pt-8 sm:px-6">
      <div className="mx-auto max-w-2xl rounded-2xl border border-neutral-200 bg-white p-2 shadow-lg shadow-primary-900/5">
        {/* Tabs */}
        <div role="tablist" aria-label={t('tablistLabel')} className="grid grid-cols-2 gap-1">
          {TABS.map(({ id, Icon }) => {
            const selected = active === id;
            return (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[id] = el;
                }}
                role="tab"
                id={`landing-tab-${id}`}
                aria-selected={selected}
                aria-controls={`landing-panel-${id}`}
                tabIndex={selected ? 0 : -1}
                type="button"
                onClick={() => setActive(id)}
                onKeyDown={onTabKeyDown}
                className={cn(
                  'flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors',
                  'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-600/40',
                  selected
                    ? 'bg-primary-700 text-white shadow-sm'
                    : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {t(id === 'find' ? 'tabFindJob' : 'tabHireTalent')}
              </button>
            );
          })}
        </div>

        {/* Find a Job panel — native GET form into the existing /jobs search */}
        <div
          role="tabpanel"
          id="landing-panel-find"
          aria-labelledby="landing-tab-find"
          hidden={active !== 'find'}
          className="pt-3"
        >
          <form action={`/${locale}/jobs`} method="get" className="flex flex-col gap-2.5">
            <div>
              <label htmlFor="landing-q" className="sr-only">
                {t('keywordLabel')}
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-neutral-600"
                  aria-hidden="true"
                />
                <Input
                  id="landing-q"
                  name="q"
                  type="search"
                  placeholder={t('keywordPlaceholder')}
                  className="ps-9"
                />
              </div>
            </div>

            <div>
              <label htmlFor="landing-market" className="sr-only">
                {t('locationLabel')}
              </label>
              <div className="relative">
                <MapPin
                  className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-neutral-600"
                  aria-hidden="true"
                />
                <select
                  id="landing-market"
                  name="market"
                  defaultValue=""
                  className="h-11 w-full rounded-md border border-input bg-background ps-9 pe-3 text-base text-foreground outline-none transition-colors focus-visible:border-primary-600 focus-visible:ring-[3px] focus-visible:ring-ring/70"
                >
                  <option value="">{t('locationAll')}</option>
                  <option value="LOCAL">{t('locationIndia')}</option>
                  <option value="GULF">{t('locationGulf')}</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              className={cn(
                buttonVariants({ variant: 'primary', size: 'lg' }),
                'w-full rounded-xl font-bold',
              )}
            >
              <Search className="size-5 shrink-0" aria-hidden="true" />
              {t('submit')}
            </button>
          </form>
        </div>

        {/* Hire Talent panel — routes to the existing employer signup */}
        <div
          role="tabpanel"
          id="landing-panel-hire"
          aria-labelledby="landing-tab-hire"
          hidden={active !== 'hire'}
          className="pt-3"
        >
          <p className="text-sm font-semibold text-neutral-900">{t('hireTitle')}</p>
          <p className="mt-1 text-sm leading-relaxed text-neutral-600">{t('hireBody')}</p>
          <Link
            href={`/${locale}/signup?role=employer`}
            className={cn(
              buttonVariants({ variant: 'primary', size: 'lg' }),
              'mt-3 w-full rounded-xl font-bold',
            )}
          >
            <Users className="size-5 shrink-0" aria-hidden="true" />
            {t('hireCta')}
          </Link>
        </div>
      </div>

      {/* Popular searches — deep-link into the same /jobs search by category */}
      <div className="mx-auto mt-4 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
          {t('popularLabel')}
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {CHIPS.map((slug) => (
            <li key={slug}>
              <Link
                href={`/${locale}/jobs?category=${slug}`}
                className="inline-flex min-h-[36px] items-center rounded-full border border-neutral-200 bg-neutral-50 px-3.5 text-sm font-medium text-neutral-700 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-600/40"
              >
                {t(`chips.${slug}`)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
