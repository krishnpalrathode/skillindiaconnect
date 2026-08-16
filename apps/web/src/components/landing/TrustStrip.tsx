import { useTranslations } from 'next-intl';
import { BadgeCheck, ShieldCheck, IndianRupee, MessageCircle } from 'lucide-react';

const BADGES = [
  { key: 'verifiedEmployers', Icon: BadgeCheck },
  { key: 'protection', Icon: ShieldCheck },
  { key: 'free', Icon: IndianRupee },
  { key: 'whatsapp', Icon: MessageCircle },
] as const;

/**
 * "Why workers trust us" — the four promises, as cards.
 *
 * Promoted from a bare four-column row of icon+text into a titled section of
 * cards. The row read as a caption strip belonging to the hero; on a page that
 * now opens with a claim bar, a hero and a stats band above it, an untitled
 * strip was the fourth undifferentiated horizontal thing in a row and the eye
 * slid straight past it. A heading tells the reader what question this block
 * answers, and the cards give each promise its own edge.
 *
 * The extra top padding is load-bearing: the stats card overlaps upward into
 * the hero, so this section has to start clear of it.
 *
 * Still server-rendered with no JS.
 */
export function TrustStrip() {
  const t = useTranslations('landing.trust');

  return (
    <section aria-labelledby="trust-heading" className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2
            id="trust-heading"
            className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl"
          >
            {t('heading')}
          </h2>
          {/* Short accent rule under the heading — the same device the mockup
              uses to tie section titles back to the brand orange. */}
          <span
            aria-hidden="true"
            className="mx-auto mt-3 block h-1 w-16 rounded-full bg-accent-500"
          />
        </div>

        <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BADGES.map(({ key, Icon }, i) => (
            <li
              key={key}
              /* Tail of the hero entrance: starts at 260ms, 60ms apart, so the
                 last card settles at ~840ms. Delay is inline because four
                 one-off values do not earn four utility classes. */
              className="hero-anim flex animate-hero-rise flex-col items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-sm transition-shadow hover:shadow-md"
              style={{ animationDelay: `${260 + i * 60}ms`, animationDuration: '400ms' }}
            >
              <span
                aria-hidden="true"
                className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700"
              >
                <Icon className="size-6" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-neutral-900">{t(`${key}.title`)}</p>
                <p className="mt-1 text-sm leading-snug text-neutral-700">{t(`${key}.body`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
