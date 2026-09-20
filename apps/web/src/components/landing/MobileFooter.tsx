import Link from 'next/link';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ShieldCheck, BadgeCheck, Globe } from 'lucide-react';
import { SOCIALS } from './socials';

/**
 * Mobile-only footer (below `lg`): a simple, single-column footer over the
 * workers/landmarks banner, replacing the full multi-column desktop footer at
 * phone widths. Desktop keeps <LandingFooter> (the page wraps that in
 * `hidden lg:block`), so the desktop footer is unchanged.
 *
 * Deliberately omits, per the platform's content-integrity rule, the mockup's
 * fabricated testimonial ("Watch Stories", named review) and third-party logos —
 * only true claims and real links appear here.
 *
 * Server component. LanguageSwitcher is a client island; `locale` is passed in
 * so no client router hook is needed here.
 */
const PROMISES = [
  { key: 'verified', Icon: ShieldCheck },
  { key: 'free', Icon: BadgeCheck },
  { key: 'global', Icon: Globe },
] as const;

export function MobileFooter({ locale }: { locale: string }) {
  const t = useTranslations('landing');
  const tCommon = useTranslations('common');
  const year = new Date().getFullYear();

  const links = [
    { label: t('footer.aboutUs'), href: `/${locale}/about` },
    { label: t('footer.privacy'), href: `/${locale}/privacy` },
    { label: t('footer.termsOfService'), href: `/${locale}/terms` },
    { label: t('footer.contactUs'), href: `/${locale}/contact` },
  ];

  return (
    <footer className="relative isolate overflow-hidden lg:hidden">
      {/* Banner background + navy scrim for legibility. */}
      <Image
        src="/hero/footer-image.png"
        alt=""
        aria-hidden="true"
        fill
        sizes="100vw"
        className="z-0 object-cover object-center"
      />
      {/* Navy scrim ABOVE the image so text stays legible over the bright parts
          of the photo; a touch darker at the foot. Explicit z-order: image z-0,
          scrim z-10, content z-20. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 z-10 bg-gradient-to-b from-[#0b1f3ae0] via-[#0b1f3aeb] to-[#081627f7]"
      />

      <div className="relative z-20 px-5 py-6 text-center">
        {/* Brand */}
        <Link
          href={`/${locale}`}
          className="inline-flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/40"
        >
          <Image
            src="/brand/SIC_mark.png"
            alt=""
            aria-hidden="true"
            width={32}
            height={32}
            className="size-8 shrink-0 rounded-full bg-white p-0.5"
          />
          <span className="text-base font-bold tracking-tight text-white">{tCommon('brand')}</span>
        </Link>

        <p className="mx-auto mt-2 max-w-[16rem] text-xs leading-relaxed text-white/85">
          {t('footer.connectTagline')}
        </p>

        {/* Promises — inline row (compact) */}
        <ul className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
          {PROMISES.map(({ key, Icon }) => (
            <li key={key} className="flex items-center gap-1.5 text-xs font-medium text-white/90">
              <Icon className="size-4 shrink-0 text-accent-300" aria-hidden="true" />
              {t(`announce.${key}`)}
            </li>
          ))}
        </ul>

        {/* Essential links */}
        <nav
          aria-label={tCommon('brand')}
          className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5"
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-white/80 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/40"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Socials */}
        <ul className="mt-4 flex flex-wrap justify-center gap-2">
          {SOCIALS.map((s) => (
            <li key={s.name}>
              <a
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.name}
                style={{ backgroundColor: s.color }}
                className="flex size-8 items-center justify-center rounded-full text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/40"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-3.5"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d={s.path} />
                </svg>
              </a>
            </li>
          ))}
        </ul>

        {/* Bottom bar — a single compact meta line (language now lives in the
            header, and the brand script was removed to keep the footer short). */}
        <div className="mt-5 border-t border-white/15 pt-4">
          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-white/70">
            <span className="inline-flex items-center gap-1.5 uppercase tracking-wide">
              <span
                aria-hidden="true"
                className="inline-flex h-3 w-5 shrink-0 flex-col overflow-hidden rounded-[2px] ring-1 ring-white/20"
              >
                <span className="h-1 bg-[#FF9933]" />
                <span className="h-1 bg-white" />
                <span className="h-1 bg-[#138808]" />
              </span>
              {t('footer.madeInIndia')}
            </span>
            <span aria-hidden="true">·</span>
            <span>{t('footer.rights', { year })}</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
