import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ShieldCheck, BadgeCheck, Globe } from 'lucide-react';

/**
 * Mobile-only hero (below `lg`): the supplied banner artwork (worker + skyline +
 * plane + destination signpost, all baked into the image) as a full-bleed
 * background, with the translatable text (pill, headline, subline, value
 * promises) overlaid on the left over a navy scrim for legibility. Desktop keeps
 * the existing <Hero> (this renders only inside the page's `lg:hidden` wrapper),
 * so the desktop landing is unchanged.
 *
 * The banner is NOT `priority` — the overlaid text is plain HTML and paints
 * immediately, and the section reserves its height, so the image loading later
 * shifts nothing (CLS 0) and never blocks the search below.
 *
 * NOTE: the signpost destinations are text baked into the raster banner, so they
 * do not localise (they stay English under /hi and /ar). The translatable copy
 * lives in the pill, headline, subline and value row.
 *
 * Server component, zero client JS.
 */
const BADGES = [
  { key: 'verified', Icon: ShieldCheck },
  { key: 'free', Icon: BadgeCheck },
  { key: 'global', Icon: Globe },
] as const;

export function MobileHero() {
  const t = useTranslations('landing');

  return (
    <section className="relative isolate min-h-[34rem] overflow-hidden bg-primary-900">
      {/* Banner artwork — worker, skyline, plane, destination signpost. */}
      <Image
        src="/hero/dashbordimage.png"
        alt={t('hero.imageAlt')}
        fill
        sizes="100vw"
        className="object-cover object-[78%_center]"
      />
      {/* Legibility scrims: strong navy on the left (behind the text), a soft
          floor at the bottom so it meets the search panel cleanly. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-r from-primary-900 via-primary-900/80 to-primary-900/5"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-primary-900/70 to-transparent"
      />

      {/* Overlaid text — left column */}
      <div className="relative z-10 px-4 pb-9 pt-7">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
          <ShieldCheck className="size-3.5 shrink-0 text-accent-300" aria-hidden="true" />
          {t('announce.verified')}
        </span>

        <h1 className="mt-4 max-w-[62%] text-[1.6rem] font-bold leading-[1.12] tracking-tight text-white">
          {t.rich('hero.headline', {
            hl: (chunks) => <span className="text-accent-300">{chunks}</span>,
          })}
        </h1>

        <p className="mt-3 max-w-[58%] text-sm leading-relaxed text-white/90">
          {t('hero.subline')}
        </p>

        {/* The three promises */}
        <ul className="mt-6 flex max-w-[62%] flex-col gap-2.5">
          {BADGES.map(({ key, Icon }) => (
            <li key={key} className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-accent-300"
              >
                <Icon className="size-4" />
              </span>
              <span className="text-xs font-semibold leading-tight text-white">
                {t(`hero.badges.${key}`)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
