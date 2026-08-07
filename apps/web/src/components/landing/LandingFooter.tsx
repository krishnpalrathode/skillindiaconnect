'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { Mail, MapPin, Phone } from 'lucide-react';
import { LanguageSwitcher } from '@/components/auth/LanguageSwitcher';

// ── Contact + social (single source of truth) ────────────────────────────────
// Real business details. Update here only; every page's footer reads from this.
const CONTACT = {
  address: '107, Rohit House, Connaught Place, New Delhi - 110001, India',
  email: 'divyansh.intl@gmail.com',
  phones: ['011 4356 8626', '011 2373 3332'],
};

// lucide-react 1.x ships no brand glyphs, so socials use inline Simple Icons
// paths (24×24 viewBox, single path, currentColor).
const SOCIALS: { name: string; href: string; path: string }[] = [
  {
    name: 'X',
    href: 'https://x.com/divyansh_intl',
    path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  },
  {
    name: 'Facebook',
    href: 'https://www.facebook.com/people/Divyansh-Intl/pfbid0336FmVg9v8kjcFPim6GmWJwXmUoZLump5MqSmrAv1QdQsYYSmd4ysDv8Ds5em22ZZl/',
    path: 'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z',
  },
  {
    name: 'Instagram',
    href: 'https://www.instagram.com/divyanshinternantional/?hl=en',
    path: 'M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0Zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.897 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.897-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03Zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162ZM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4Zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439Z',
  },
  {
    name: 'LinkedIn',
    href: 'https://www.linkedin.com/company/divyanshinternational/',
    path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z',
  },
  {
    name: 'WhatsApp',
    href: 'https://wa.me/9319391055',
    path: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.885 3.488',
  },
  {
    name: 'Telegram',
    href: 'https://t.me/divyansh_intl',
    path: 'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z',
  },
];

/** Strip a phone label down to a tel:-safe digit string. */
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/**
 * Public footer — a single shared component so the footer is identical on every
 * page that renders it (landing + all StaticPageShell pages). Dark brand surface
 * with brand block, navigation columns, a full Contact column (address / email /
 * phones), and a social row.
 *
 * Client-only because LanguageSwitcher reads the router. Every nav href points at
 * a route that exists and is PUBLIC — /jobs sits behind the (app) auth shell, so
 * "Find Jobs" goes to /signup, the same destination the hero CTAs use.
 */
export function LandingFooter() {
  const t = useTranslations('landing.footer');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';
  const year = new Date().getFullYear();

  const columns = [
    {
      heading: t('explore'),
      links: [
        { label: t('about'), href: `/${locale}/about` },
        { label: t('findJobs'), href: `/${locale}/signup` },
        { label: t('hireWorkers'), href: `/${locale}/signup?role=employer` },
      ],
    },
    {
      heading: t('company'),
      // No sign-in links here: the header already carries Login and Sign Up on
      // every landing screen, and repeating them in the footer duplicated the
      // primary call to action in the least prominent place on the page.
      links: [
        { label: t('privacy'), href: `/${locale}/privacy` },
        { label: t('terms'), href: `/${locale}/terms` },
      ],
    },
  ];

  return (
    <footer className="border-t border-white/10 bg-gradient-to-b from-[#0B1F3A] to-[#081627] text-neutral-300">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:py-16">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-8">
          {/* Brand block */}
          <div className="lg:col-span-4">
            <Link
              href={`/${locale}`}
              className="inline-flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/40"
            >
              {/* On this dark surface the mark's white backing reads as a clean
                  circular badge (intentional here — unlike a tinted surface). */}
              <Image
                src="/brand/SIC_mark.png"
                alt=""
                aria-hidden="true"
                width={44}
                height={44}
                className="size-11 shrink-0 rounded-full bg-white p-0.5"
              />
              <span className="text-lg font-bold tracking-tight text-white">
                {tCommon('brand')}
              </span>
            </Link>

            <p className="mt-4 max-w-sm text-sm leading-relaxed text-neutral-400">{t('tagline')}</p>

            {/* Social row */}
            <h2 className="mt-8 text-xs font-bold uppercase tracking-wider text-white">
              {t('followUs')}
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2.5">
              {SOCIALS.map((s) => (
                <li key={s.name}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.name}
                    className="flex size-9 items-center justify-center rounded-full bg-white/10 text-neutral-200 transition-colors hover:bg-primary-600 hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/40"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="size-4"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d={s.path} />
                    </svg>
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Navigation columns */}
          {columns.map((col) => (
            <nav key={col.heading} aria-label={col.heading} className="lg:col-span-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                {col.heading}
              </h2>
              <ul className="mt-4 flex flex-col gap-1">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="inline-flex min-h-[44px] items-center rounded text-sm text-neutral-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/40 lg:min-h-[2rem]"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          {/* Contact column */}
          <div className="lg:col-span-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-white">
              {t('contact')}
            </h2>
            <ul className="mt-4 flex flex-col gap-3 text-sm">
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-4 shrink-0 text-primary-300" aria-hidden="true" />
                <span className="leading-relaxed text-neutral-400">{CONTACT.address}</span>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="size-4 shrink-0 text-primary-300" aria-hidden="true" />
                <a
                  href={`mailto:${CONTACT.email}`}
                  aria-label={t('emailLabel')}
                  className="break-all text-neutral-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/40"
                >
                  {CONTACT.email}
                </a>
              </li>
              {CONTACT.phones.map((phone) => (
                <li key={phone} className="flex items-center gap-3">
                  <Phone className="size-4 shrink-0 text-primary-300" aria-hidden="true" />
                  <a
                    href={telHref(phone)}
                    aria-label={t('callUs')}
                    className="text-neutral-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/40"
                  >
                    {phone}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 flex flex-col gap-4 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-neutral-500">{t('rights', { year })}</p>

          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-500">{t('languageLabel')}</span>
            <LanguageSwitcher variant="dark" />
          </div>
        </div>
      </div>
    </footer>
  );
}
