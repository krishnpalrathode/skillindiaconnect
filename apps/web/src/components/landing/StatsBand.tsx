import { useTranslations, useFormatter } from 'next-intl';
import { Users, Building2, Briefcase, Globe2 } from 'lucide-react';

/**
 * ⚠️ MARKETING FIGURES — NOT MEASURED, AND NOT WIRED TO THE DATABASE. ⚠️
 *
 * These are the numbers from the approved landing design. They are claims the
 * product owner is making, not counts this app computed: nothing here reads
 * `candidate_profiles`, `companies` or `applications`.
 *
 * They live in ONE place, as data, for two reasons. First so replacing them is
 * a four-line edit rather than a hunt through JSX. Second so it stays obvious
 * that they are editorial — a hardcoded `25,000+` buried in markup reads like a
 * fact the system knows, and it isn't one.
 *
 * Two things to know before launch:
 *  - A platform whose entire pitch is "we verify everything, no fake listings"
 *    is the worst possible place to publish a number that cannot be defended.
 *    Whoever signs off on these should be comfortable being asked for them.
 *  - When real counts exist, this array is the seam: give it a server-fetched
 *    props shape and the component below does not change.
 */
const STATS = [
  { key: 'workers', value: 25000, suffix: '+', Icon: Users, tone: 'accent' },
  { key: 'employers', value: 5000, suffix: '+', Icon: Building2, tone: 'primary' },
  { key: 'placements', value: 10000, suffix: '+', Icon: Briefcase, tone: 'success' },
  { key: 'countries', value: 20, suffix: '+', Icon: Globe2, tone: 'primary' },
] as const;

/** Icon tile colours per stat — kept out of the JSX so the map stays readable. */
const TONES: Record<(typeof STATS)[number]['tone'], string> = {
  accent: 'bg-accent-50 text-accent-600',
  primary: 'bg-primary-50 text-primary-700',
  success: 'bg-success-bg text-success-fg',
};

/**
 * The proof band that straddles the hero and the section below it.
 *
 * Deliberately a raised white card pulled UP into the hero (`-mt-*`): it breaks
 * the boundary between the two sections, which stops the page reading as a
 * stack of unrelated full-width strips and gives the hero a visual floor.
 *
 * White on the navy hero is the strongest contrast pairing on the page, which
 * is why the numbers live here rather than in a tinted band lower down — this
 * is the one block that should be impossible to scroll past.
 *
 * Numbers are rendered through `useFormatter`, so Hindi gets Indian digit
 * grouping (25,000) and Arabic gets its own numerals rather than every locale
 * being handed a hardcoded Latin string.
 */
export function StatsBand() {
  const t = useTranslations('landing.stats');
  const format = useFormatter();

  return (
    <section aria-label={t('ariaLabel')} className="relative z-10 px-4 sm:px-6">
      <ul className="mx-auto -mt-8 grid max-w-7xl grid-cols-2 gap-x-4 gap-y-6 rounded-2xl border border-neutral-200/80 bg-white px-5 py-6 shadow-[0_18px_50px_-24px_rgba(15,61,145,0.35)] sm:-mt-10 sm:px-8 sm:py-7 lg:grid-cols-4">
        {STATS.map(({ key, value, suffix, Icon, tone }, i) => (
          <li
            key={key}
            className={[
              'flex items-center gap-3',
              // Hairline separators between columns only where they sit side by
              // side. Logical `border-s` so RTL flips it automatically.
              i > 0 ? 'lg:border-s lg:border-neutral-200 lg:ps-6' : '',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${TONES[tone]}`}
            >
              <Icon className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xl font-bold leading-none text-neutral-900 sm:text-2xl">
                {format.number(value)}
                {suffix}
              </p>
              <p className="mt-1 text-xs leading-snug text-neutral-600 sm:text-sm">{t(key)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
