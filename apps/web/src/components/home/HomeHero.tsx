import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';

/**
 * The phone home's opening card: a headline, a line of support, and one CTA
 * into the existing job search.
 *
 * ── The image can never move anything ───────────────────────────────────────
 * The card's height comes from its own padding and content, and the photograph
 * is an ABSOLUTELY POSITIONED decorative layer behind that. So the text and the
 * CTA are laid out and tappable in the first frame, and when the image arrives
 * it paints into space that was already reserved — there is no reflow to cause,
 * whatever the connection is doing. It is `loading="lazy"` and deliberately not
 * `priority`: nothing on this card waits for it.
 *
 * `alt=""` because it is decoration. A screen reader announcing "worker in a
 * hi-vis vest holding a hard hat" before the headline would be noise, not
 * information — the headline already says what this card is.
 *
 * ── No carousel dots ────────────────────────────────────────────────────────
 * The mockup shows them. There is one hero here, so dots would be an
 * indicator of nothing — a control that cannot be pressed and does not move.
 * That is exactly the kind of detail that makes an app feel like a mock-up of
 * an app. (The landing page has a REAL carousel, `HeroCarousel`, if this ever
 * needs to become one.)
 */
export function HomeHero({ locale }: { locale: string }) {
  const t = useTranslations('home.hero');

  return (
    <section aria-labelledby="home-hero-heading">
      <div className="relative overflow-hidden rounded-2xl bg-primary-700 px-5 py-7 text-white shadow-sm">
        {/*
          Decorative, behind everything. `fill` needs a positioned ancestor,
          which the wrapper provides; the low opacity keeps the headline at full
          contrast on the navy rather than fighting a photograph for it.
        */}
        <Image
          src="/hero/worker-construction.jpg"
          alt=""
          aria-hidden="true"
          fill
          loading="lazy"
          sizes="(max-width: 1024px) 100vw, 0px"
          className="pointer-events-none select-none object-cover opacity-20"
        />

        {/* The gradient is what guarantees the text stays legible regardless of
            which part of the photograph sits under it. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary-700 via-primary-700/85 to-primary-700/60"
        />

        <div className="relative flex flex-col gap-3">
          <h2 id="home-hero-heading" className="text-2xl font-bold leading-tight">
            {t('headline')}
          </h2>
          <p className="text-sm leading-snug text-white/85">{t('subline')}</p>

          <div>
            <Link
              href={`/${locale}/jobs`}
              className={cn(
                buttonVariants({ variant: 'brand', size: 'md' }),
                'mt-1 min-h-11 font-bold',
              )}
            >
              <Search className="size-4" aria-hidden="true" />
              {t('cta')}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
