'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { Mail } from 'lucide-react';
import { LanguageSwitcher } from '@/components/auth/LanguageSwitcher';

const SUPPORT_EMAIL = 'support@skillindiaconnect.com';

/**
 * Public footer. Client-only because LanguageSwitcher reads the router.
 *
 * Layout: a 12-column grid — brand block on the start side, the link columns
 * grouped in the remaining 8 so they stay evenly distributed across the width
 * instead of clustering in the last two columns.
 *
 * Every href points at a route that actually exists and is PUBLIC. /jobs is
 * behind the (app) auth shell, which is why "Find Jobs" goes to /signup — the
 * same destination the hero and category CTAs use.
 */
export function LandingFooter() {
  const t = useTranslations('landing.footer');
  const tCommon = useTranslations('common');
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
    {
      heading: t('getStarted'),
      links: [
        { label: t('findJobs'), href: `/${locale}/signup` },
        { label: t('hireWorkers'), href: `/${locale}/signup?role=employer` },
        { label: t('login'), href: `/${locale}/login` },
        { label: t('employerLogin'), href: `/${locale}/employer-login` },
      ],
    },
  ];

  return (
    <footer className="border-t border-neutral-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-16">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-8">
          {/* Brand block */}
          <div className="lg:col-span-4">
            <Link
              href={`/${locale}`}
              className="inline-flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              {/* The mark is a flattened PNG on white — the white footer hides its
                  backing box. Do not put it on a tinted surface. */}
              <Image
                src="/brand/SIC_mark.png"
                alt=""
                aria-hidden="true"
                width={40}
                height={40}
                className="size-10 shrink-0 rounded-full"
              />
              <span className="text-lg font-bold tracking-tight text-primary-700">
                {tCommon('brand')}
              </span>
            </Link>

            <p className="mt-4 max-w-sm text-sm leading-relaxed text-neutral-600">{t('tagline')}</p>

            <h2 className="mt-8 text-xs font-bold uppercase tracking-wider text-neutral-900">
              {t('support')}
            </h2>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              aria-label={t('emailLabel')}
              className="mt-1 inline-flex min-h-[44px] items-center gap-2 rounded text-sm font-medium text-neutral-700 transition-colors hover:text-primary-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              <Mail className="size-4 shrink-0" aria-hidden="true" />
              <span className="break-all">{SUPPORT_EMAIL}</span>
            </a>
          </div>

          {/* Link columns */}
          <div className="lg:col-span-8">
            <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
              {columns.map((col) => (
                <nav key={col.heading} aria-label={col.heading}>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-900">
                    {col.heading}
                  </h2>
                  <ul className="mt-4 flex flex-col gap-1">
                    {col.links.map((l) => (
                      <li key={l.href}>
                        <Link
                          href={l.href}
                          className="inline-flex min-h-[44px] items-center rounded text-sm text-neutral-600 transition-colors hover:text-primary-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 lg:min-h-[2rem]"
                        >
                          {l.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 flex flex-col gap-4 border-t border-neutral-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-neutral-600">{t('rights', { year })}</p>

          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-600">{t('languageLabel')}</span>
            <LanguageSwitcher variant="light" />
          </div>
        </div>
      </div>
    </footer>
  );
}
