import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ShieldCheck, BadgeCheck, Search, UserRound, Globe } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { HeroCarousel } from './HeroCarousel';
import { cn } from '@/lib/utils';

/** The reassurance row under the CTAs — see the comment at its render site. */
const HERO_BADGES = [
  { key: 'verified', Icon: ShieldCheck },
  { key: 'free', Icon: BadgeCheck },
  { key: 'global', Icon: Globe },
] as const;

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

    Devanagari sets wider than Latin at the same point size, so Hindi steps down
    one size rather than being clipped.

    Hindi is the only entry left. The Indic regional locales this list also named
    were retired with the move to a world-language set, and the languages that
    replaced them — French, German, Spanish, Portuguese, Russian, Chinese and
    Japanese — all set at or below Latin width here. Arabic likewise.
  */
  const WIDE_SETTING_LOCALES = ['hi'];
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
        {/*
          ── Left column: copy + CTAs (entrance sequence unchanged) ──

          M4: below `lg` this becomes a centred app-entry screen; from `lg` up
          every value is restored and the desktop landing is exactly what it
          was. `lg` is the breakpoint the hero's own grid already switches on,
          so "phone" here means precisely "the width at which the copy is the
          full row".
        */}
        <div className="max-w-3xl text-center lg:text-start">
          {/*
            Mark + wordmark, phone only. The desktop landing already carries the
            logo in its sticky header at a comfortable size; on a phone that
            header is a 72px strip and this screen is the product's front door,
            so the brand is stated once, properly, on the dark ground.

            SIC_mark.png rather than logo.png: it is a 96px transparent mark, so
            it sits on the navy without the light canvas that logo.png needs
            `object-cover` to crop away. The wordmark is text — it scales, it
            translates nowhere (a proper noun), and it costs no bytes.
          */}
          <div className="mb-6 flex items-center justify-center gap-2.5 lg:hidden">
            <Image
              src="/brand/SIC_mark.png"
              alt=""
              aria-hidden="true"
              width={40}
              height={40}
              priority
              className="size-10 shrink-0"
            />
            <span className="text-lg font-bold tracking-tight text-white">Skill India Connect</span>
          </div>

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
            className="hero-anim animate-hero-rise mx-auto mt-6 max-w-xl text-base leading-relaxed text-white/90 sm:text-lg lg:mx-0 lg:text-xl"
            style={{ animationDelay: '100ms' }}
          >
            {t('subline')}
          </p>

          <div
            className="hero-anim animate-hero-rise-scale mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start lg:items-center"
            style={{ animationDelay: '180ms' }}
          >
            {/*
              "Find Verified Jobs" goes to the JOB SEARCH, not to signup.

              It used to route to `/signup`, which meant the one button on this
              page promising jobs delivered a registration form instead. The
              search is already public, crawlable and unauthenticated — there is
              nothing to gate — and the strongest argument this page can make to
              a stranger is simply that the listings are real. The header still
              carries Sign up and Log in, so no path is lost; the button just
              does what it says.
            */}
            <Link
              href={`/${locale}/jobs`}
              className={cn(
                buttonVariants({ variant: 'primary', size: 'lg' }),
                'group rounded-xl font-bold shadow-lg shadow-black/20',
                'transition-[transform,box-shadow] duration-150 ease-out',
                'hover:scale-[1.02] hover:shadow-xl hover:shadow-black/25 active:scale-[0.98]',
              )}
            >
              <Search className="size-5 shrink-0" aria-hidden="true" />
              {t('ctaWorker')}
            </Link>

            <Link
              href={`/${locale}/signup?role=employer`}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                /*
                  border-white/50, not /40. The outlined button's edge is the
                  only thing that says it IS a button, so it is non-text UI and
                  needs 3:1 against the ground. Measured on the lightest
                  gradient stop (primary-700 #1a3c6e): /40 gives 3.12:1 — it
                  passes, with almost nothing to spare, and any future darkening
                  of the hero drops it below. /50 gives 4.02:1 and is visually
                  indistinguishable.
                */
                'rounded-xl border-2 border-white/50 bg-transparent font-bold text-white',
                'transition-[transform,background-color,border-color] duration-150 ease-out',
                'hover:scale-[1.02] hover:border-white hover:bg-white/10 active:scale-[0.98] active:bg-white/20',
              )}
            >
              <UserRound className="size-5 shrink-0" aria-hidden="true" />
              {t('ctaEmployer')}
            </Link>
          </div>

          {/*
            The three promises, inline under the CTAs.

            Same claims as the navy bar at the top of the page, restated at the
            point of decision — someone who has just read the headline and is
            deciding whether to press the orange button should not have to scroll
            back up to remember that it is free. Rendered as one wrapping row of
            small items rather than a second band, so it supports the button
            instead of competing with it.
          */}
          <ul
            className="hero-anim animate-hero-rise mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 lg:justify-start"
            style={{ animationDelay: '240ms' }}
          >
            {HERO_BADGES.map(({ key, Icon }) => (
              <li
                key={key}
                className="flex items-center gap-1.5 text-sm font-semibold text-white/85"
              >
                <Icon className="size-4 shrink-0 text-accent-300" aria-hidden="true" />
                {t(`badges.${key}`)}
              </li>
            ))}
          </ul>
        </div>

        {/* ── Right column: auto-advancing worker imagery ── */}
        <HeroCarousel />
      </div>
    </section>
  );
}
