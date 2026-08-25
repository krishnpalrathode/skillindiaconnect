'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Home, Briefcase, FileText, User } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MobileTab {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
}

/**
 * The four destinations, in the order the brief specifies. Icons come from the
 * lucide set the rest of the shell already uses — no second icon library.
 *
 * `Home` rather than the sidebar's `LayoutDashboard`: on a phone this tab is
 * the way back to the start, and a dashboard-grid glyph reads as "analytics"
 * at 20px next to three other nouns.
 */
export function buildMobileTabs(
  locale: string,
  pathname: string,
  t: (key: string) => string,
): MobileTab[] {
  return [
    {
      href: `/${locale}/dashboard`,
      label: t('home'),
      icon: <Home className="size-5" aria-hidden="true" />,
      active: pathname.endsWith('/dashboard'),
    },
    {
      href: `/${locale}/jobs`,
      label: t('jobs'),
      icon: <Briefcase className="size-5" aria-hidden="true" />,
      active: pathname.includes('/jobs'),
    },
    {
      href: `/${locale}/applications`,
      label: t('applications'),
      icon: <FileText className="size-5" aria-hidden="true" />,
      active: pathname.includes('/applications'),
    },
    {
      href: `/${locale}/profile`,
      label: t('profile'),
      icon: <User className="size-5" aria-hidden="true" />,
      active: pathname.includes('/profile'),
    },
  ];
}

/**
 * Fixed bottom tab bar — PHONE WIDTHS ONLY (`lg:hidden`).
 *
 * This is responsive CSS, not a second app. The same tree renders at every
 * width; above `lg` this bar is display:none and the sidebar takes over. There
 * is deliberately no check for "are we in the TWA" anywhere — the installed app
 * and the browser at the same width get the same thing, which is the only way
 * one codebase stays one codebase.
 *
 * ── The active state is not carried by colour ────────────────────────────────
 * Colour alone would fail WCAG 1.4.1 and would be invisible to a candidate with
 * a colour-vision deficiency — a real slice of a blue-collar workforce. Three
 * signals stack: an accent underline (a shape, present or absent), a heavier
 * label weight, and `aria-current="page"` for assistive tech.
 *
 * ── Safe area ───────────────────────────────────────────────────────────────
 * The bar pads ITSELF by `env(safe-area-inset-bottom)`, growing on a device
 * with a gesture bar so the tappable row sits above it rather than under it. On
 * a device without one the inset is 0 and nothing changes. The content offset
 * in the layout is derived from the same expression, so the two cannot drift.
 */
export function MobileTabBar({ tabs }: { tabs: MobileTab[] }) {
  const t = useTranslations('nav');

  return (
    <nav
      aria-label={t('primaryLabel')}
      /*
        A language-independent handle for tests. The accessible name is
        translated, and it is deliberately the SAME as the desktop sidebar's
        ("Main navigation") because only one of the two is ever in the
        accessibility tree at a given width — so neither the name nor a label
        match can single this bar out under Arabic.
      */
      data-testid="mobile-tab-bar"
      className={cn(
        'lg:hidden fixed bottom-0 inset-x-0 z-30',
        'border-t border-neutral-200 bg-white',
        // The inset lifts the row off the gesture bar; without it the last few
        // pixels of every tap target are eaten by the system UI.
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <ul className="flex items-stretch">
        {tabs.map((tab) => (
          <li key={tab.href} className="flex-1 min-w-0">
            <Link
              href={tab.href}
              aria-current={tab.active ? 'page' : undefined}
              className={cn(
                // min-h-[56px] keeps the whole cell past the 44px minimum even
                // before the label wraps; flex-1 gives four equal columns that
                // cannot overflow 360px.
                'relative flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2',
                'transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/70',
                tab.active ? 'text-primary-700' : 'text-neutral-600',
              )}
            >
              {/* Signal 1: a shape, not a hue. Rendered above the icon so it
                  reads as an indicator rather than a text decoration. */}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-0 h-0.5 w-10 rounded-b-full transition-opacity',
                  tab.active ? 'bg-accent-500 opacity-100' : 'opacity-0',
                )}
              />
              {tab.icon}
              {/* Signal 2: weight. truncate + max-w keeps a long translation on
                  one line instead of pushing the bar taller. */}
              <span
                className={cn(
                  'max-w-full truncate text-[11px] leading-none',
                  tab.active ? 'font-semibold' : 'font-medium',
                )}
              >
                {tab.label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
