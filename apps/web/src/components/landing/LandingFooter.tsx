'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import {
  BadgeCheck,
  Briefcase,
  Clock,
  ExternalLink,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Sprout,
} from 'lucide-react';
import { LanguageSwitcher } from '@/components/auth/LanguageSwitcher';
import { SOCIALS } from './socials';

// ── Contact + social (single source of truth) ────────────────────────────────
// Real business details. Update here only; every page's footer reads from this.
const CONTACT = {
  address: '107, Rohit House, Connaught Place, New Delhi - 110001, India',
  email: 'divyansh.intl@gmail.com',
  phones: ['011 4356 8626', '011 2373 3332'],
};

// The parent company. External site, so the footer link opens in a new tab. The
// mark is the opaque Divyansh app icon (white glyph on their navy) shown as a
// small rounded chip — the name stays real, legible text beside it.
const PARENT_COMPANY = {
  name: 'Divyansh International',
  href: 'https://divyansh.international/',
  mark: '/brand/divyansh-international-mark.png',
};

// Brand marks for the two app stores, drawn inline so no image assets are needed.
// The badges are non-clickable "coming soon" placeholders (no live listing yet).
const APPLE_PATH =
  'M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z';
// The Google Play mark in its brand colours: the folded triangle split into
// four segments (viewBox 24). The left triangle carries a blue→green gradient;
// the two side flaps are red (top) and amber (bottom); the tip blends the two.
const PLAY_SEGMENTS: { d: string; fill: string }[] = [
  {
    d: 'M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.61 3,21.09 3,20.5Z',
    fill: 'url(#gp-spine)',
  },
  { d: 'M16.81,8.88L6.05,2.66L14.54,11.15L16.81,8.88Z', fill: '#ff3d00' },
  { d: 'M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12Z', fill: '#ffc400' },
  {
    d: 'M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.5,12.92 20.16,13.19L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81Z',
    fill: 'url(#gp-tip)',
  },
];

/** Strip a phone label down to a tel:-safe digit string. */
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/**
 * Public footer — a single shared component so the footer is identical on every
 * page that renders it (landing + all StaticPageShell pages). Dark brand surface
 * with a brand block, three navigation columns (job seekers / employers /
 * company), a full Contact column, a trust band and a bottom bar.
 *
 * Client-only because LanguageSwitcher reads the router and Back-to-top scrolls
 * the window. EVERY nav href points at a route that exists and is PUBLIC — the
 * (app) routes (/jobs, /resume) sit behind the auth shell, so intents that need
 * an account ("Find Jobs", "Create Profile", "Hire Workers", "Post a Job") go to
 * the matching signup/login the header CTAs already use. No dead links.
 */
export function LandingFooter() {
  const t = useTranslations('landing.footer');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';
  const year = new Date().getFullYear();

  // Quick Links merges the seeker + employer actions into one column (7 items,
  // balanced across both audiences); Company is the second nav column. Each href
  // points at a real, existing route.
  const columns = [
    {
      heading: t('quickLinks'),
      links: [
        { label: t('findJobs'), href: `/${locale}/signup` },
        { label: t('createProfile'), href: `/${locale}/signup` },
        { label: t('resumeBuilder'), href: `/${locale}/resume` },
        { label: t('hireSkilledWorkers'), href: `/${locale}/signup?role=employer` },
        { label: t('postJob'), href: `/${locale}/signup?role=employer` },
        { label: t('browseProfiles'), href: `/${locale}/signup?role=employer` },
        { label: t('helpSupport'), href: `/${locale}/contact` },
      ],
    },
    {
      heading: t('company'),
      links: [
        { label: t('aboutUs'), href: `/${locale}/about` },
        { label: t('ourMission'), href: `/${locale}/about` },
        { label: t('impact'), href: `/${locale}/about` },
        { label: t('blogNews'), href: `/${locale}/about` },
        { label: t('privacy'), href: `/${locale}/privacy` },
        { label: t('termsOfService'), href: `/${locale}/terms` },
        { label: t('contactUs'), href: `/${locale}/contact` },
      ],
    },
  ];

  const trust = [
    { icon: ShieldCheck, label: t('trustSecure') },
    { icon: BadgeCheck, label: t('trustVerified') },
    { icon: Briefcase, label: t('trustReal') },
    { icon: Sprout, label: t('trustEmpower') },
  ];

  // Store badges are English artwork by brand convention, so the two lines are
  // not translated. No live listing yet, so the badges are presentational
  // (non-clickable); the QR below points at the live website.
  const appBadges = [
    { name: 'App Store', tagline: 'Download on the', path: APPLE_PATH },
    { name: 'Google Play', tagline: 'GET IT ON', path: null },
  ];

  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-gradient-to-b from-[#0B1F3A] to-[#081627] text-neutral-300">
      {/* Soft brand glow, purely decorative. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 end-[-6rem] size-72 rounded-full bg-primary-500/10 blur-3xl"
      />

      {/* India skyline silhouette, anchored full-width to the bottom. Purely
          decorative — the artwork's navy field is the same tone as the footer
          gradient, so only the monuments read; if the asset is missing the
          footer just loses the texture and everything else is unaffected. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 top-0 bg-[url('/brand/footer-skyline.png')] bg-[length:100%_auto] bg-bottom bg-no-repeat opacity-70"
      />

      <div className="relative mx-auto max-w-screen-2xl px-4 py-10 sm:px-6 lg:py-12">
        {/* ── Top: brand · quick links · company · contact · app ───────────── */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-3 xl:grid-cols-[1.9fr_1.1fr_1.1fr_1.4fr_1.2fr] xl:gap-x-8">
          {/* Brand block */}
          <div className="col-span-2 md:col-span-3 xl:col-span-1">
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
                width={48}
                height={48}
                className="size-12 shrink-0 rounded-full bg-white p-0.5"
              />
              <span className="flex flex-col leading-tight">
                <span className="text-lg font-bold tracking-tight text-white">
                  {tCommon('brand')}
                </span>
                <span className="text-xs font-medium text-primary-300">{t('slogan')}</span>
              </span>
            </Link>

            <p className="mt-4 max-w-sm text-sm leading-relaxed text-neutral-400">{t('tagline')}</p>

            {/* Parent company — below the brand name. External site, so it
                opens in a new tab. */}
            <a
              href={PARENT_COMPANY.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-4 inline-flex items-center gap-2 rounded text-sm text-neutral-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/40"
            >
              <span className="text-neutral-500">{t('parentCompany')}</span>
              <Image
                src={PARENT_COMPANY.mark}
                alt=""
                aria-hidden="true"
                width={24}
                height={24}
                className="size-6 shrink-0 rounded-md ring-1 ring-white/10"
              />
              <span className="font-medium">{PARENT_COMPANY.name}</span>
              <ExternalLink
                className="size-3.5 text-neutral-500 transition-colors group-hover:text-neutral-300"
                aria-hidden="true"
              />
              <span className="sr-only">({t('opensNewTab')})</span>
            </a>

            {/* Social row */}
            <h2 className="mt-6 text-xs font-bold uppercase tracking-wider text-white">
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
                    style={{ backgroundColor: s.color }}
                    className="flex size-9 items-center justify-center rounded-full text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/40"
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
            <nav key={col.heading} aria-label={col.heading} className="col-span-1 xl:col-span-1">
              <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                {col.heading}
              </h2>
              <ul className="mt-4 flex flex-col gap-1">
                {col.links.map((l) => (
                  <li key={l.label}>
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

          {/* Get in Touch column */}
          <div className="col-span-2 md:col-span-2 xl:col-span-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-white">
              {t('getInTouch')}
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
              <li className="flex items-center gap-3">
                <Clock className="size-4 shrink-0 text-primary-300" aria-hidden="true" />
                <span className="text-neutral-400">{t('hours')}</span>
              </li>
            </ul>
          </div>

          {/* Download our app column. No live store listing yet, so the badges
              are presentational (non-clickable) rather than links; the QR is a
              real code that opens the live website. */}
          <div className="col-span-2 md:col-span-1 xl:col-span-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-white">
              {t('downloadApp')}
            </h2>
            <p className="mt-3 max-w-[16rem] text-xs leading-relaxed text-neutral-400">
              {t('appTagline')}
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              {appBadges.map((b) => (
                <span
                  key={b.name}
                  role="img"
                  aria-label={t('appComingSoonAria', { app: b.name })}
                  className="inline-flex w-40 max-w-full cursor-default items-center gap-2.5 rounded-lg bg-black px-3 py-2 ring-1 ring-white/15"
                >
                  {b.name === 'Google Play' ? (
                    <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden="true">
                      <defs>
                        <linearGradient id="gp-spine" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0" stopColor="#00c3ff" />
                          <stop offset="1" stopColor="#00e676" />
                        </linearGradient>
                        <linearGradient id="gp-tip" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0" stopColor="#ff3d00" />
                          <stop offset="1" stopColor="#ffc400" />
                        </linearGradient>
                      </defs>
                      {PLAY_SEGMENTS.map((seg) => (
                        <path key={seg.d} d={seg.d} fill={seg.fill} />
                      ))}
                    </svg>
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      className="size-6 shrink-0 text-white"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d={b.path ?? ''} />
                    </svg>
                  )}
                  <span className="flex flex-col text-start leading-none">
                    <span className="text-[9px] uppercase tracking-wide text-neutral-300">
                      {b.tagline}
                    </span>
                    <span className="mt-0.5 text-sm font-semibold text-white">{b.name}</span>
                  </span>
                </span>
              ))}
            </div>

            {/* QR — real code encoding the live site URL. */}
            <div className="mt-4 flex items-center gap-3">
              <Image
                src="/brand/footer-qr.png"
                alt=""
                aria-hidden="true"
                width={64}
                height={64}
                className="size-16 shrink-0 rounded-md bg-white p-1"
              />
              <span className="max-w-[8rem] text-xs leading-tight text-neutral-400">
                {t('scanToDownload')}
              </span>
            </div>
          </div>
        </div>

        {/* ── Bottom bar — one compact band: copyright · trust badges · controls ──
            The top margin leaves the skyline backdrop room to show through. */}
        <div className="mt-16 flex flex-col gap-x-6 gap-y-4 border-t border-white/10 pt-5 xl:flex-row xl:items-center xl:justify-between">
          {/* Copyright + Made in India */}
          <div className="shrink-0 space-y-1">
            <p className="text-sm text-neutral-500">{t('rights', { year })}</p>
            <p className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-neutral-500">
              <span
                aria-hidden="true"
                className="inline-flex h-3 w-5 shrink-0 flex-col overflow-hidden rounded-[2px] ring-1 ring-white/15"
              >
                <span className="h-1 bg-[#FF9933]" />
                <span className="h-1 bg-white" />
                <span className="h-1 bg-[#138808]" />
              </span>
              {t('madeInIndia')}
            </p>
          </div>

          {/* Trust badges — inline row */}
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {trust.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-500/15 text-primary-200">
                  <Icon className="size-3.5" aria-hidden="true" />
                </span>
                <span className="text-xs font-medium text-neutral-300">{label}</span>
              </li>
            ))}
          </ul>

          {/* Language + Back to top */}
          <div className="flex shrink-0 items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-500">{t('languageLabel')}</span>
              <LanguageSwitcher variant="dark" />
            </div>
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/15 px-4 text-sm font-medium text-neutral-200 transition-colors hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/40"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
              {t('backToTop')}
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
