import { useTranslations, useFormatter } from 'next-intl';
import { Users, Building2, Globe2 } from 'lucide-react';
import type { LandingStats } from '@/lib/api/stats';

/**
 * Desktop stats band — the counterpart of the stats bar inside <MobileHero>.
 *
 * Figures are the editorial baseline PLUS the live counts from GET /stats,
 * composed in `lib/api/stats.ts`; this component only renders them.
 *
 * A raised white card pulled UP into the hero (`-mt-*`), so it gives the hero a
 * visual floor instead of reading as another full-width strip.
 */
const STATS = [
  { key: 'workers', Icon: Users, tone: 'bg-accent-50 text-accent-600' },
  { key: 'employers', Icon: Building2, tone: 'bg-primary-50 text-primary-700' },
  { key: 'countries', Icon: Globe2, tone: 'bg-success-bg text-success-fg' },
] as const;

export function StatsBand({ stats }: { stats: LandingStats }) {
  const t = useTranslations('landing.stats');
  const format = useFormatter();

  return (
    <section aria-label={t('ariaLabel')} className="relative z-10 px-4 sm:px-6">
      <ul className="mx-auto -mt-10 grid max-w-7xl grid-cols-3 gap-x-4 rounded-2xl border border-neutral-200/80 bg-white px-8 py-7 shadow-[0_18px_50px_-24px_rgba(15,61,145,0.35)]">
        {STATS.map(({ key, Icon, tone }, i) => (
          <li
            key={key}
            className={[
              'flex items-center gap-3',
              // Logical `border-s` so RTL flips it automatically.
              i > 0 ? 'border-s border-neutral-200 ps-6' : '',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${tone}`}
            >
              <Icon className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-2xl font-bold leading-none text-neutral-900">
                {/* Inline LTR island keeps the "+" after the number in RTL
                    without pulling the whole line to the left. */}
                <span dir="ltr">{format.number(stats[key])}+</span>
              </p>
              <p className="mt-1 text-sm leading-snug text-neutral-600">{t(key)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
