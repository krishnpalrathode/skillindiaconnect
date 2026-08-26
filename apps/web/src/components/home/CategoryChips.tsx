import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Zap, HardHat, Wrench, Car, Droplets, Flame } from 'lucide-react';

/**
 * Six trades, each a link into the EXISTING filtered job search.
 *
 * ── The slugs are real, and the filter is real ──────────────────────────────
 * Every `slug` below is a row in `job_categories`, and `?category=<slug>` is
 * the parameter `parseJobSearchParams` already reads and the search API already
 * honours — verified against the running API (4,519 open jobs unfiltered,
 * 432 for `electrician`). This builds no parallel filter and invents no route.
 *
 * Worth noting for whoever reads the landing page next: its `JobCategories`
 * carries a comment saying category filtering "is not a public deep-link yet"
 * and therefore renders presentational tiles. That is now out of date — those
 * tiles could be wired the same way.
 *
 * ── One substitution, stated ────────────────────────────────────────────────
 * The design asked for Electrical, Construction, Technician, Driver, Plumber
 * and Welding. Five map onto a real category. "Construction" does not exist as
 * one — the seeded trades are specific (mason, steel-fixer, carpenter,
 * pipe-fitter…) rather than an umbrella. MASON is used in its place: it is the
 * largest genuinely-construction trade here, and pointing a tile at a category
 * that returns nothing because it does not exist would be worse than naming the
 * trade a worker actually holds.
 *
 * ── A category with no jobs is normal ───────────────────────────────────────
 * On a young platform most of these will be thin, and that is fine: the tile
 * always links, and the search page's own empty state does the explaining.
 * Hiding or disabling a tile based on a count would need a count this page does
 * not have, and would make the grid change shape between visits.
 */
const CATEGORIES = [
  { slug: 'electrician', Icon: Zap, tone: 'bg-amber-50 text-amber-700' },
  { slug: 'mason', Icon: HardHat, tone: 'bg-orange-50 text-orange-700' },
  { slug: 'hvac-technician', Icon: Wrench, tone: 'bg-sky-50 text-sky-700' },
  { slug: 'driver', Icon: Car, tone: 'bg-emerald-50 text-emerald-700' },
  { slug: 'plumber', Icon: Droplets, tone: 'bg-cyan-50 text-cyan-700' },
  { slug: 'welder', Icon: Flame, tone: 'bg-rose-50 text-rose-700' },
] as const;

export function CategoryChips({ locale }: { locale: string }) {
  const t = useTranslations('home.categories');

  return (
    <section aria-labelledby="home-categories-heading">
      <h2
        id="home-categories-heading"
        className="mb-3 text-base font-bold leading-snug text-neutral-900"
      >
        {t('heading')}
      </h2>

      <ul className="grid grid-cols-3 gap-3">
        {CATEGORIES.map(({ slug, Icon, tone }) => (
          <li key={slug}>
            <Link
              href={`/${locale}/jobs?category=${slug}`}
              // min-h-[88px] keeps the whole tile a comfortable target, well
              // past the 44px floor, at three columns on a 360px screen.
              className="flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-2xl border border-neutral-200/70 bg-white px-2 py-3 text-center shadow-sm transition-colors hover:border-primary-200 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              <span
                aria-hidden="true"
                className={`flex size-9 items-center justify-center rounded-xl ${tone}`}
              >
                <Icon className="size-4.5" />
              </span>
              {/* break-words: "HVAC Technician" and its Hindi and Arabic
                  translations are all longer than a 100px-wide tile. */}
              <span className="break-words text-xs font-medium leading-tight text-neutral-800">
                {t(`slug.${slug}`)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
