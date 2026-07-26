import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  HardHat,
  Car,
  Zap,
  Flame,
  Wrench,
  UtensilsCrossed,
  Hammer,
  SprayCan,
  ArrowRight,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';

const CATEGORIES = [
  { key: 'construction', Icon: HardHat },
  { key: 'driving', Icon: Car },
  { key: 'electrical', Icon: Zap },
  { key: 'welding', Icon: Flame },
  { key: 'plumbing', Icon: Wrench },
  { key: 'hospitality', Icon: UtensilsCrossed },
  { key: 'carpentry', Icon: Hammer },
  { key: 'housekeeping', Icon: SprayCan },
] as const;

/**
 * Trade categories. Cards are presentational (the public job search requires
 * no auth, but category filtering is not a public deep-link yet) — the single
 * CTA below routes to signup rather than fabricating per-category links.
 */
export function JobCategories({ locale }: { locale: string }) {
  const t = useTranslations('landing.categories');

  return (
    <section aria-labelledby="categories-heading" className="bg-neutral-50 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2
            id="categories-heading"
            className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl"
          >
            {t('heading')}
          </h2>
          <p className="mt-2 text-base text-neutral-700">{t('subheading')}</p>
        </div>

        <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {CATEGORIES.map(({ key, Icon }) => (
            <li
              key={key}
              className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-5 text-center shadow-sm transition-shadow hover:shadow-md"
            >
              <span
                aria-hidden="true"
                className="flex size-12 items-center justify-center rounded-xl bg-accent-50 text-accent-600"
              >
                <Icon className="size-6" />
              </span>
              <span className="text-sm font-semibold text-neutral-800">{t(key)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-8">
          <Link
            href={`/${locale}/signup`}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'lg' }),
              'group rounded-xl border-2 border-primary-700 bg-white font-bold text-primary-700 transition-all hover:bg-primary-50',
            )}
          >
            {t('cta')}
            <ArrowRight
              className="size-5 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        </div>
      </div>
    </section>
  );
}
