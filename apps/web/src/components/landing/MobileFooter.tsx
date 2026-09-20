import Link from 'next/link';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ShieldCheck, BadgeCheck, Globe } from 'lucide-react';
import { LanguageSwitcher } from '@/components/auth/LanguageSwitcher';
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

      <div className="relative z-20 px-5 py-10 text-center">
        {/* Brand */}
        <Link
          href={`/${locale}`}
          className="inline-flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/40"
        >
          <Image
            src="/brand/SIC_mark.png"
            alt=""
            aria-hidden="true"
            width={40}
            height={40}
            className="size-9 shrink-0 rounded-full bg-white p-0.5"
          />
          <span className="text-lg font-bold tracking-tight text-white">{tCommon('brand')}</span>
        </Link>

        <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-white/85">
          {t('footer.connectTagline')}
        </p>

        {/* Promises */}
        <ul className="mx-auto mt-7 flex max-w-xs flex-col gap-3 text-start">
          {PROMISES.map(({ key, Icon }) => (
            <li key={key} className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-accent-300">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="text-sm font-medium text-white/90">{t(`announce.${key}`)}</span>
            </li>
          ))}
        </ul>

        {/* Essential links */}
        <nav
          aria-label={tCommon('brand')}
          className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2"
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
        <h2 className="mt-8 text-xs font-bold uppercase tracking-wider text-white/70">
          {t('footer.followUs')}
        </h2>
        <ul className="mt-3 flex flex-wrap justify-center gap-2.5">
          {SOCIALS.map((s) => (
            <li key={s.name}>
              <a
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.name}
                style={{ backgroundColor: s.color }}
                className="flex size-9 items-center justify-center rounded-full text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/40"
              >
                <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
                  <path d={s.path} />
                </svg>
              </a>
            </li>
          ))}
        </ul>

        {/* Brand script */}
        <p className="mt-8 font-serif text-base italic text-accent-200/90">
          {t('footer.buildBetterWorld')}
        </p>

        {/* Bottom bar */}
        <div className="mt-6 flex flex-col items-center gap-4 border-t border-white/15 pt-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-white/70">{t('footer.languageLabel')}</span>
            <LanguageSwitcher variant="dark" />
          </div>
          <p className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-white/70">
            <span
              aria-hidden="true"
              className="inline-flex h-3 w-5 shrink-0 flex-col overflow-hidden rounded-[2px] ring-1 ring-white/20"
            >
              <span className="h-1 bg-[#FF9933]" />
              <span className="h-1 bg-white" />
              <span className="h-1 bg-[#138808]" />
            </span>
            {t('footer.madeInIndia')}
          </p>
          <p className="text-sm text-white/70">{t('footer.rights', { year })}</p>
        </div>
      </div>
    </footer>
  );
}
