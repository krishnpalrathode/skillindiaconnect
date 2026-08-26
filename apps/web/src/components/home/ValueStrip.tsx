import { useTranslations } from 'next-intl';
import { BadgeCheck, ShieldCheck, IndianRupee, Globe2 } from 'lucide-react';

/**
 * Four claims about what a worker actually gets — NOT counts.
 *
 * ── Why there are no numbers here ───────────────────────────────────────────
 * The design this came from showed "25,000+ Jobs Available" and three more like
 * it. Those are not measurements: nothing in this app counts them. On a
 * platform whose entire pitch is "we verify everything, no fake listings", a
 * figure that cannot be defended is the most expensive kind of decoration — and
 * the people reading it are deciding whether to hand us their passport scan.
 *
 * Claims are stronger here anyway. "Free for workers" is checkable, true, and
 * the thing a candidate paying an agent three months' wages elsewhere actually
 * needs to hear.
 *
 * ── The copy is REUSED, not rewritten ───────────────────────────────────────
 * Three of these four already exist, translated, as the landing page's
 * `landing.trust` claims. Reading them from the same keys means the public page
 * and the signed-in home can never end up promising different things — which is
 * a real risk when the same promise is typed twice.
 *
 * The fourth cell is the one that differs: the landing strip's fourth claim is
 * about WhatsApp updates, which someone already signed in has by now seen for
 * themselves. Reach — India and Gulf — is the more useful thing to say to a
 * candidate deciding where to look next, and it is what this product is.
 */
const CELLS = [
  { key: 'verifiedEmployers', Icon: BadgeCheck, source: 'trust' },
  { key: 'free', Icon: IndianRupee, source: 'trust' },
  { key: 'protection', Icon: ShieldCheck, source: 'trust' },
  { key: 'reach', Icon: Globe2, source: 'home' },
] as const;

export function ValueStrip() {
  const tTrust = useTranslations('landing.trust');
  const tHome = useTranslations('home.value');

  return (
    <section aria-labelledby="home-value-heading">
      <h2 id="home-value-heading" className="sr-only">
        {tHome('ariaLabel')}
      </h2>

      <ul className="grid grid-cols-2 rounded-2xl border border-neutral-200/70 bg-white shadow-sm">
        {CELLS.map(({ key, Icon, source }, i) => {
          const title = source === 'trust' ? tTrust(`${key}.title`) : tHome(`${key}.title`);
          const body = source === 'trust' ? tTrust(`${key}.body`) : tHome(`${key}.body`);

          return (
            <li
              key={key}
              className={[
                'flex flex-col items-center gap-1.5 px-3 py-5 text-center',
                /*
                  Hairlines BETWEEN cells only, never around the outside — the
                  card's own border does that. Logical `border-s`/`border-e` so
                  the grid flips correctly in Arabic without a second rule.
                */
                i % 2 === 0 ? 'border-e border-neutral-200/70' : '',
                i < 2 ? 'border-b border-neutral-200/70' : '',
              ].join(' ')}
            >
              {/* Decorative: the words below carry the meaning, so an icon-only
                  reading would tell a screen-reader user nothing. */}
              <span
                aria-hidden="true"
                className="flex size-10 items-center justify-center rounded-xl bg-primary-50 text-primary-700"
              >
                <Icon className="size-5" />
              </span>
              <p className="text-sm font-semibold leading-tight text-neutral-900">{title}</p>
              <p className="text-xs leading-snug text-neutral-600">{body}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
