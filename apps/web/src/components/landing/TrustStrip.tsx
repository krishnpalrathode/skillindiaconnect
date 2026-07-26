import { useTranslations } from 'next-intl';
import { BadgeCheck, ShieldCheck, IndianRupee, MessageCircle } from 'lucide-react';

const BADGES = [
  { key: 'verifiedEmployers', Icon: BadgeCheck },
  { key: 'protection', Icon: ShieldCheck },
  { key: 'free', Icon: IndianRupee },
  { key: 'whatsapp', Icon: MessageCircle },
] as const;

/** Four short trust badges directly under the hero. Server-rendered, no JS. */
export function TrustStrip() {
  const t = useTranslations('landing.trust');

  return (
    <section aria-label={t('ariaLabel')} className="border-b border-neutral-200 bg-white">
      <ul className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-4 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:py-10">
        {BADGES.map(({ key, Icon }, i) => (
          <li
            key={key}
            /* Tail of the hero entrance: starts at 260ms, 60ms apart, so the
               last badge settles at ~840ms. Delay is inline because four
               one-off values do not earn four utility classes. */
            className="hero-anim flex animate-hero-rise items-start gap-3"
            style={{ animationDelay: `${260 + i * 60}ms`, animationDuration: '400ms' }}
          >
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700"
            >
              <Icon className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-neutral-900">{t(`${key}.title`)}</p>
              <p className="mt-0.5 text-sm leading-snug text-neutral-700">{t(`${key}.body`)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
