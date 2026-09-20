import { useTranslations } from 'next-intl';
import { BadgeCheck, IndianRupee, Home, Globe2 } from 'lucide-react';

/**
 * Mobile-only value strip — the honest replacement for the marketing statistics
 * shown in the design mockup ("100K+ workers", "10,000+ jobs", …).
 *
 * Those figures are NOT measured by this product (see the warning in
 * StatsBand.tsx). On the page whose entire pitch is "we don't invent things",
 * publishing numbers we can't defend is the worst possible content. So this
 * keeps the mockup's four-cell treatment (icon, two lines, hairline dividers)
 * but fills it with claims that are TRUE and, in the case of accommodation,
 * enforced in code by the job publish guard.
 *
 * Rendered only below `lg` (the page wraps it in `lg:hidden`); desktop keeps its
 * existing StatsBand, so the desktop landing is untouched.
 *
 * Server component, zero client JS.
 */
const CELLS = [
  { key: 'verified', Icon: BadgeCheck, ltr: true },
  { key: 'free', Icon: IndianRupee, ltr: false },
  { key: 'stay', Icon: Home, ltr: false },
  { key: 'reach', Icon: Globe2, ltr: false },
] as const;

export function MobileValueStrip() {
  const t = useTranslations('landing.valueStrip');

  return (
    <section aria-label={t('ariaLabel')} className="bg-white px-4 pt-6 sm:px-6">
      <ul className="mx-auto grid max-w-2xl grid-cols-4 gap-x-2 rounded-2xl border border-neutral-200/80 bg-white px-2 py-4 shadow-sm">
        {CELLS.map(({ key, Icon, ltr }, i) => (
          <li
            key={key}
            className={[
              'flex flex-col items-center gap-1.5 px-1 text-center',
              // Hairline separators between the cells (logical border flips in RTL).
              i > 0 ? 'border-s border-neutral-200' : '',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-lg bg-primary-50 text-primary-700"
            >
              <Icon className="size-[18px]" />
            </span>
            {/* Numeric/figure lines are forced LTR so "100%" reads correctly
                inside Arabic (requirement: numbers stay LTR in RTL). */}
            <p
              dir={ltr ? 'ltr' : undefined}
              className="text-sm font-bold leading-none text-neutral-900"
            >
              {t(`${key}.a`)}
            </p>
            <p className="text-[11px] leading-tight text-neutral-600">{t(`${key}.b`)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
