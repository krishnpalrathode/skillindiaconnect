import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { HeroCarousel } from './HeroCarousel';
import { cn } from '@/lib/utils';

/**
 * Hero — server-rendered, zero client JS.
 *
 * Motion notes:
 * - Every animation is CSS keyframes on `transform`/`opacity` only, so it runs
 *   on the compositor and can never trigger layout → CLS stays 0.
 * - The invisible from-state lives inside the keyframes (fill-mode `both`),
 *   never in a base class, so if the stylesheet fails to load the content
 *   still paints. There is no flash-of-nothing.
 * - `prefers-reduced-motion` removes entrance + ambient motion entirely
 *   (globals.css) and the content is simply present.
 *
 * Entrance timeline (ends ~840ms, under the 900ms budget):
 *   headline 0ms · subline 100ms · CTAs 180ms · trust badges 260ms+60ms each
 *   underline draws at 1240ms — 400ms after the entrance settles.
 */
export function Hero({ locale }: { locale: string }) {
  const t = useTranslations('landing.hero');

  /*
    The accent phrase is `whitespace-nowrap` from `sm` up so its underline stays
    a single box, which means the phrase itself must fit the column at 60px.

    Indic scripts set considerably wider than Latin at the same point size, and
    the headline grew when it took on "for Skilled Workers" — so every locale
    whose accent phrase is a long Indic rendering of "Safe, verified jobs" steps
    down one size rather than being clipped. This used to name Hindi alone,
    which quietly left Tamil, Malayalam, Telugu and Kannada — all of which set
    wider than Hindi — overflowing.

    Arabic, Urdu, Persian and Pashto stay at full size: their accent phrases are
    shorter than the Latin one, not longer.
  */
  const WIDE_SETTING_LOCALES = [
    'hi',
    'mr',
    'ne',
    'bn',
    'as',
    'or',
    'pa',
    'gu',
    'ta',
    'te',
    'ml',
    'kn',
    'si',
    'am',
  ];
  const headlineSize = WIDE_SETTING_LOCALES.includes(locale) ? 'lg:text-5xl' : 'lg:text-6xl';

  return (
    <section className="relative isolate overflow-hidden bg-gradient-to-br from-primary-800 via-primary-700 to-primary-900">
      {/* ── Ambient layer — decorative, out of flow, cannot shift layout ── */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        {/* Drifting radial glows */}
        <div className="hero-ambient absolute -end-24 -top-24 size-96 animate-hero-glow-drift rounded-full bg-accent-500/20 blur-3xl" />
        <div
          className="hero-ambient absolute -bottom-32 -start-24 size-96 animate-hero-glow-drift rounded-full bg-primary-400/25 blur-3xl"
          style={{ animationDelay: '-7s' }}
        />

        {/* Floating geometry — low opacity, long slow loops */}
        <div className="hero-ambient absolute start-[8%] top-[18%] size-16 animate-hero-float-a rounded-2xl border border-white/10 bg-white/5 sm:size-20" />
        <div className="hero-ambient absolute end-[12%] top-[24%] size-12 animate-hero-float-b rounded-full bg-accent-400/15 sm:size-16" />
        <div className="hero-ambient absolute end-[22%] bottom-[16%] size-14 animate-hero-float-c rounded-2xl bg-white/5 sm:size-24" />
        <div className="hero-ambient absolute start-[22%] bottom-[12%] hidden size-10 animate-hero-float-b rounded-full border border-white/10 sm:block" />

        {/* Static grid — no animation, just texture */}
        <svg
          className="absolute inset-0 size-full opacity-[0.06]"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern id="hero-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0v40" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#hero-grid)" />
        </svg>
      </div>

      {/* Text column gets a little more width than the carousel so the 60px
          headline has room without the nowrap accent phrase overflowing. */}
      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.15fr_1fr] lg:gap-12 lg:py-28">
        {/* ── Left column: copy + CTAs (entrance sequence unchanged) ── */}
        <div className="max-w-3xl">
          <h1
            className={cn(
              'hero-anim animate-hero-rise text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-5xl',
              headlineSize,
            )}
          >
            {t.rich('headline', {
              hl: (chunks) => (
                // nowrap only from `sm` up: it keeps the accent phrase on one
                // line (so the underline stays a single box) where there is
                // room for it. Below `sm` the phrase may wrap, so the underline
                // is hidden there rather than drawn across a two-line box —
                // the accent colour still marks the phrase.
                <span className="relative inline-block text-accent-300 sm:whitespace-nowrap">
                  {chunks}
                  {/* Signature moment: underline draws from the reading-start
                      edge. transform-origin flips under [dir=rtl]. */}
                  <span
                    aria-hidden="true"
                    className="hero-underline absolute inset-x-0 -bottom-1.5 hidden h-1.5 animate-hero-underline rounded-full bg-accent-500 sm:block sm:h-2"
                  />
                </span>
              ),
            })}
          </h1>

          <p
            className="hero-anim animate-hero-rise mt-6 max-w-xl text-base leading-relaxed text-white/85 sm:text-lg lg:text-xl"
            style={{ animationDelay: '100ms' }}
          >
            {t('subline')}
          </p>

          <div
            className="hero-anim animate-hero-rise-scale mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"
            style={{ animationDelay: '180ms' }}
          >
            <Link
              href={`/${locale}/signup`}
              className={cn(
                buttonVariants({ variant: 'primary', size: 'lg' }),
                'group rounded-xl font-bold shadow-lg shadow-black/20',
                'transition-[transform,box-shadow] duration-150 ease-out',
                'hover:scale-[1.02] hover:shadow-xl hover:shadow-black/25 active:scale-[0.98]',
              )}
            >
              {t('ctaWorker')}
              <ArrowRight
                className="size-5 transition-transform duration-150 group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
                aria-hidden="true"
              />
            </Link>

            <Link
              href={`/${locale}/signup?role=employer`}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'rounded-xl border-2 border-white/40 bg-transparent font-bold text-white',
                'transition-[transform,background-color,border-color] duration-150 ease-out',
                'hover:scale-[1.02] hover:border-white hover:bg-white/10 active:scale-[0.98] active:bg-white/20',
              )}
            >
              {t('ctaEmployer')}
            </Link>
          </div>

          <p
            className="hero-anim animate-hero-rise mt-5 flex items-center gap-2 text-sm font-medium text-white/80"
            style={{ animationDelay: '240ms' }}
          >
            <ShieldCheck className="size-4 shrink-0 text-accent-300" aria-hidden="true" />
            {t('freeNote')}
          </p>
        </div>

        {/* ── Right column: auto-advancing worker imagery ── */}
        <HeroCarousel />
      </div>
    </section>
  );
}
