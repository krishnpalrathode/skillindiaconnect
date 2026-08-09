'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { routing } from '@/i18n/routing';

/**
 * Sets the browser-tab title for EVERY route as `Brand | Section | Page`
 * (e.g. "Skill India Connect | Admin | Dashboard").
 *
 * Why a client component and not per-page `metadata`: almost every page here is
 * a Client Component, and Client Components cannot export `metadata`. One
 * pathname-driven setter covers all of them uniformly (and updates on client
 * navigation, where a server title would not re-run). The brand is localized;
 * the section/page labels are English for now (see the maps below) and can be
 * moved into a `titles` i18n namespace later without touching this logic.
 */

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/** Parts AFTER the brand, e.g. ['Admin', 'Dashboard'] or ['Jobs']. */
function pageParts(seg: string[]): string[] {
  const [a, b, c, d] = seg;
  if (!a) return []; // home → brand only

  // ── Admin console ─────────────────────────────────────────────────────────
  if (a === 'admin') {
    if (b === 'jobs' && c === 'new') return ['Admin', 'Post job'];
    if (b === 'employers') return ['Admin', c ? 'Employer' : 'Employers'];
    if (b === 'candidates') return ['Admin', c ? 'Candidate' : 'Candidates'];
    if (b === 'jobs') return ['Admin', c ? 'Job' : 'Jobs'];
    if (b === 'applications') return ['Admin', c ? 'Application' : 'Applications'];
    const pages: Record<string, string> = {
      dashboard: 'Dashboard',
      logs: 'Audit log',
      roles: 'Roles & permissions',
      settings: 'Settings',
    };
    return ['Admin', pages[b ?? ''] ?? cap(b ?? '')];
  }

  // ── Employer portal ───────────────────────────────────────────────────────
  if (a === 'employer') {
    if (b === 'jobs' && c === 'new') return ['Employer', 'Post job'];
    if (b === 'jobs' && c && d === 'applicants') return ['Employer', 'Applicants'];
    if (b === 'jobs' && c && d === 'edit') return ['Employer', 'Edit job'];
    if (b === 'jobs') return ['Employer', c ? 'Job' : 'Jobs'];
    if (b === 'candidates') return ['Employer', c ? 'Candidate' : 'Candidates'];
    const pages: Record<string, string> = {
      dashboard: 'Dashboard',
      profile: 'Profile',
      subscription: 'Subscription',
      onboarding: 'Onboarding',
    };
    return ['Employer', pages[b ?? ''] ?? cap(b ?? '')];
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  if (a === 'employer-login') return ['Employer log in'];
  const auth: Record<string, string> = {
    login: 'Log in',
    signup: 'Sign up',
    'forgot-password': 'Reset password',
    callback: 'Signing in',
  };
  if (auth[a]) return [auth[a]!];

  // ── Onboarding ────────────────────────────────────────────────────────────
  if (a === 'onboarding') return [b === 'employer' ? 'Employer onboarding' : 'Onboarding'];

  // ── Public / marketing ────────────────────────────────────────────────────
  const publicPages: Record<string, string> = {
    about: 'About',
    contact: 'Contact',
    privacy: 'Privacy policy',
    terms: 'Terms',
  };
  if (publicPages[a]) return [publicPages[a]!];

  // ── Candidate app (no section prefix — this is the primary app) ────────────
  if (a === 'jobs') return [b ? 'Job details' : 'Jobs'];
  if (a === 'applications') return [b ? 'Application' : 'Applications'];
  const candidate: Record<string, string> = {
    dashboard: 'Dashboard',
    notifications: 'Notifications',
    profile: 'Profile',
  };
  if (candidate[a]) return [candidate[a]!];

  return [cap(a)];
}

/**
 * Build the full tab title (`Brand | Section | Page`) for a pathname. Exported
 * (and pure) so the route→title mapping can be unit-tested without a browser.
 */
export function documentTitle(pathname: string, brand: string): string {
  const seg = (pathname || '/').split('/').filter(Boolean);
  // usePathname (next/navigation) keeps the [locale] prefix — drop it.
  if (seg.length > 0 && (routing.locales as readonly string[]).includes(seg[0]!)) {
    seg.shift();
  }
  return [brand, ...pageParts(seg)].join(' | ');
}

export function RouteTitle() {
  const pathname = usePathname();
  const t = useTranslations('common');

  useEffect(() => {
    document.title = documentTitle(pathname ?? '/', t('brand'));
  }, [pathname, t]);

  return null;
}
