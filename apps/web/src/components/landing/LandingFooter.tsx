'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { Mail } from 'lucide-react';
import { LanguageSwitcher } from '@/components/auth/LanguageSwitcher';

const SUPPORT_EMAIL = 'support@skillindiaconnect.com';

/**
 * Public footer. Client-only because LanguageSwitcher reads the router.
 *
 * NOTE: /about, /contact, /privacy and /terms are not implemented in this app
 * yet — SignupForm already links to /privacy and /terms with the same gap.
 * These hrefs are locale-prefixed and ready for those pages to land.
 */
export function LandingFooter() {
  const t = useTranslations('landing.footer');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';
  const year = new Date().getFullYear();

  const columns = [
    {
      heading: t('company'),
      links: [
        { label: t('about'), href: `/${locale}/about` },
        { label: t('contact'), href: `/${locale}/contact` },
      ],
    },
    {
      heading: t('legal'),
      links: [
        { label: t('privacy'), href: `/${locale}/privacy` },
        { label: t('terms'), href: `/${locale}/terms` },
      ],
    },
  ];

  return (
    <footer className="border-t border-neutral-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <p className="text-base font-bold text-primary-700">SkillIndiaConnect</p>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-neutral-700">{t('tagline')}</p>
          </div>

          {columns.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h2 className="text-sm font-bold text-neutral-900">{col.heading}</h2>
              <ul className="mt-3 flex flex-col gap-2">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="inline-flex min-h-[44px] items-center rounded text-sm text-neutral-700 transition-colors hover:text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-5 border-t border-neutral-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              aria-label={t('emailLabel')}
              className="inline-flex min-h-[44px] items-center gap-2 rounded text-sm font-medium text-neutral-700 transition-colors hover:text-primary-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              <Mail className="size-4 shrink-0" aria-hidden="true" />
              {SUPPORT_EMAIL}
            </a>

            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-600">{t('languageLabel')}</span>
              <LanguageSwitcher variant="light" />
            </div>
          </div>

          <p className="text-sm text-neutral-600">{t('rights', { year })}</p>
        </div>
      </div>
    </footer>
  );
}
