import { useTranslations } from 'next-intl';
import { ShieldCheck, BadgeCheck, Globe } from 'lucide-react';

const ITEMS = [
  { key: 'verified', Icon: ShieldCheck },
  { key: 'free', Icon: BadgeCheck },
  { key: 'global', Icon: Globe },
] as const;

/**
 * The claim bar between the white header and the navy hero.
 *
 * It states the three things a wary candidate needs before they read anything
 * else — verified, free, and not just local — at the first moment they could
 * possibly read them.
 *
 * It is `primary-900` while the hero below starts at `primary-800`, so the two
 * navies are deliberately one step apart: the bar reads as its own band rather
 * than as the top of the hero, without introducing a colour the brand does not
 * already use. The hairline under it does the rest of that separation.
 *
 * Server-rendered, no JS, no images. It is the first painted element after the
 * header, so it must cost nothing.
 */
export function AnnouncementBar() {
  const t = useTranslations('landing.announce');

  return (
    <section
      aria-label={t('ariaLabel')}
      className="border-b border-white/10 bg-primary-900 text-white"
    >
      <ul
        className={[
          'mx-auto flex max-w-7xl flex-col items-stretch gap-y-2 px-4 py-3 sm:px-6',
          // From `sm` up the three claims sit on one line, evenly spread, with
          // hairline dividers between them — the band reading of the mockup.
          'sm:flex-row sm:items-center sm:justify-center sm:gap-0',
        ].join(' ')}
      >
        {ITEMS.map(({ key, Icon }) => (
          <li
            key={key}
            className={[
              'flex items-center justify-center gap-2 text-center text-xs font-semibold sm:text-sm',
              // Logical border so the divider lands on the correct side in RTL,
              // and never before the first item.
              'sm:flex-1 sm:border-s sm:border-white/20 sm:first:border-s-0',
            ].join(' ')}
          >
            <Icon className="size-4 shrink-0 text-accent-400" aria-hidden="true" />
            {t(key)}
          </li>
        ))}
      </ul>
    </section>
  );
}
