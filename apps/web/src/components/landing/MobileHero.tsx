import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ShieldCheck, Briefcase, Globe, ArrowRight, Users, Building2, Globe2 } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';

/**
 * Mobile-only hero (below `lg`) matching the marketing mockup: verified pill,
 * "Your Skills Can Take You Anywhere" headline, three feature rows, the worker /
 * skyline / destination-signpost banner on the right, two CTAs, and a stats bar.
 * Desktop keeps the existing <Hero> (this renders only inside the page's
 * `lg:hidden` wrapper), so the desktop landing is unchanged.
 *
 * The banner (worker + skyline + signpost, baked into the image) is NOT
 * `priority` — the headline/CTAs are HTML and paint first — and its box is
 * reserved so it shifts nothing on arrival (CLS 0).
 *
 * ⚠️ The stats bar (1M+, 10K+, 50+) are MARKETING figures from the mockup, not
 * counts this app measures (see the warning in StatsBand.tsx). They live here as
 * data so replacing them is a one-line edit; confirm them before launch.
 *
 * Server component, zero client JS.
 */
const FEATURES = [
  { key: 'verified', Icon: Briefcase, tone: 'bg-accent-500' },
  { key: 'free', Icon: ShieldCheck, tone: 'bg-[#16a34a]' },
  { key: 'global', Icon: Globe, tone: 'bg-[#2563eb]' },
] as const;

const STATS = [
  { key: 'workers', Icon: Users },
  { key: 'employers', Icon: Building2 },
  { key: 'countries', Icon: Globe2 },
] as const;

export function MobileHero({ locale }: { locale: string }) {
  const t = useTranslations('landing');

  return (
    <section className="relative isolate overflow-hidden bg-gradient-to-br from-primary-800 via-primary-700 to-primary-900">
      {/* Banner — worker, skyline, destination signpost, plane (baked in). */}
      <div className="absolute end-0 top-0 z-0 h-[27rem] w-[60%]">
        <Image
          src="/hero/dashbordimage.png"
          alt={t('hero.imageAlt')}
          fill
          sizes="60vw"
          className="object-cover object-[88%_16%]"
        />
      </div>
      {/* Navy fade so the left-hand text stays legible over the image. Baked
          alpha (the /opacity modifier renders transparent on this palette). */}
      <div
        aria-hidden="true"
        className="absolute inset-0 z-10 bg-gradient-to-r from-[#0b1f3a] via-[#0b1f3ae6] to-transparent"
      />

      {/* ── Content ── */}
      <div className="relative z-20 px-4 pb-6 pt-6">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
          <ShieldCheck className="size-4 shrink-0 text-accent-300" aria-hidden="true" />
          {t('announce.verified')}
        </span>

        <h1 className="mt-4 max-w-[62%] text-[2rem] font-extrabold leading-[1.06] tracking-tight text-white">
          {t.rich('hero.mobileHeadline', {
            hl: (chunks) => <span className="text-accent-400">{chunks}</span>,
          })}
        </h1>

        <p className="mt-3 max-w-[55%] text-sm leading-relaxed text-white/85">
          {t('hero.mobileSubline')}
        </p>

        {/* Feature rows */}
        <ul className="mt-5 flex max-w-[64%] flex-col gap-3">
          {FEATURES.map(({ key, Icon, tone }) => (
            <li key={key} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-11 shrink-0 items-center justify-center rounded-full text-white shadow-md',
                  tone,
                )}
              >
                <Icon className="size-5" />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-sm font-bold leading-tight text-white">
                  {t(`hero.features.${key}.title`)}
                </p>
                <p className="mt-0.5 text-xs leading-tight text-white/70">
                  {t(`hero.features.${key}.desc`)}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {/* CTAs */}
        <div className="mt-6 flex flex-col gap-3">
          <Link
            href={`/${locale}/jobs`}
            className={cn(
              buttonVariants({ variant: 'primary', size: 'lg' }),
              'w-full rounded-full font-bold shadow-lg shadow-black/20',
            )}
          >
            {t('hero.ctaFindJobs')}
            <ArrowRight className="size-5 shrink-0 rtl:rotate-180" aria-hidden="true" />
          </Link>
          <Link
            href={`/${locale}/signup`}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'lg' }),
              'w-full rounded-full border-2 border-white/50 bg-transparent font-bold text-white hover:bg-white/10',
            )}
          >
            {t('hero.ctaCreateProfile')}
          </Link>
        </div>
      </div>

      {/* Stats bar — raised white card */}
      <div className="relative z-20 px-4 pb-6">
        <ul className="grid grid-cols-3 gap-1 rounded-2xl border border-neutral-200/80 bg-white px-2 py-4 shadow-lg">
          {STATS.map(({ key, Icon }, i) => (
            <li
              key={key}
              className={cn(
                'flex flex-col items-center gap-1 px-1 text-center',
                i > 0 && 'border-s border-neutral-200',
              )}
            >
              <Icon className="size-5 text-primary-600" aria-hidden="true" />
              <p dir="ltr" className="text-base font-bold leading-none text-neutral-900">
                {t(`hero.statsBar.${key}.value`)}
              </p>
              <p className="text-[11px] leading-tight text-neutral-600">
                {t(`hero.statsBar.${key}.label`)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
