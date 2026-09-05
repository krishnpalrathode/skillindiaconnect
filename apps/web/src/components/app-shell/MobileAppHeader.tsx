'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bell, LogOut, MoreVertical, Search, ScrollText } from 'lucide-react';
import { LanguageSwitcher } from '@/components/auth/LanguageSwitcher';
import { useLogoutConfirm } from '@/lib/auth/logout-confirm';
import { useUnreadCount } from '@/lib/notifications/useUnreadCount';
import { cn } from '@/lib/utils';

/**
 * Dark app header — PHONE WIDTHS ONLY (`lg:hidden`).
 *
 * ── Why the navy is a token and not a hex ────────────────────────────────────
 * `primary-700` (#1a3c6e) is the brand anchor AND the value in the web app
 * manifest's `theme_color`. In an installed TWA the system paints the status
 * bar with the manifest colour, so the bar and this header meet edge to edge;
 * any drift between them shows up as a seam across the top of the phone. Taking
 * both from the same token is what stops that happening by accident later.
 *
 * ── What the overflow menu is for ────────────────────────────────────────────
 * The tab bar carries four destinations. Resume Builder, language and sign-out
 * are reachable ONLY from this chrome on a phone — the sidebar that holds them
 * is desktop-only — so dropping them here would strand them entirely. Two are
 * decisions the codebase argues explicitly: CR-001 calls Resume Builder a core
 * destination, and the language switcher was once missing from this shell,
 * leaving candidates unable to change language for as long as they used the
 * product. The menu keeps all three one tap away without a fifth tab.
 */
export function MobileAppHeader({ locale }: { locale: string }) {
  const t = useTranslations('appShell');
  const tNav = useTranslations('nav');
  const router = useRouter();
  const pathname = usePathname();
  const { requestLogout } = useLogoutConfirm();
  const { count } = useUnreadCount();

  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  /*
    Close on NAVIGATION, not in the link's own onClick.

    Closing in onClick unmounts the <Link> during the very click that is
    supposed to follow it, and the navigation can be lost with it — caught by
    the e2e walk, where tapping Resume Builder left the user sitting on the
    dashboard. Reacting to the route change instead means the link survives its
    own click, and the menu still closes the moment the destination is reached.
  */
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Close on an outside tap or Escape. A menu that can only be dismissed by
  // choosing something from it is a trap on a touch device, where there is no
  // "click away" instinct the way there is with a mouse.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  /**
   * Routes into the EXISTING job search with the existing param. `q` is the key
   * `parseJobSearchParams` reads, so this lands on a normal, shareable,
   * server-rendered results page — the same one the jobs screen's own controls
   * produce. There is no second search here.
   */
  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    router.push(trimmed ? `/${locale}/jobs?q=${encodeURIComponent(trimmed)}` : `/${locale}/jobs`);
  }

  // Counts are capped for LAYOUT, but the accessible name always carries the
  // true number — a screen-reader user should never be told "99+".
  const badgeText = count > 99 ? '99+' : String(count);
  const bellLabel = count > 0 ? t('notificationsWithCount', { count }) : t('notificationsNone');

  return (
    <header className="lg:hidden sticky top-0 z-30 bg-primary-700 text-white">
      <div className="flex items-center gap-2 px-3 pt-3">
        <Link
          href={`/${locale}/dashboard`}
          aria-label={t('homeLink')}
          className="relative h-9 w-28 shrink-0 overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/60"
        >
          <Image
            src="/brand/logo.png"
            alt="Skill India Connect"
            fill
            priority
            sizes="112px"
            className="object-cover object-center"
          />
        </Link>

        <div className="ms-auto flex items-center gap-1">
          <Link
            href={`/${locale}/notifications`}
            aria-label={bellLabel}
            className="relative flex size-11 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/60"
          >
            <Bell className="size-5" aria-hidden="true" />
            {count > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  // Dark text on the accent orange: #f57c20 carries 8.2:1 with
                  // black and only ~2.6:1 with white, so white here would be a
                  // badge a lot of people simply cannot read.
                  'absolute end-1 top-1 min-w-[18px] rounded-full bg-accent-500 px-1',
                  'text-[10px] font-bold leading-[18px] text-neutral-900',
                )}
              >
                {badgeText}
              </span>
            )}
          </Link>

          <div className="relative">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={t('moreMenu')}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="flex size-11 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/60"
            >
              <MoreVertical className="size-5" aria-hidden="true" />
            </button>

            {menuOpen && (
              <div
                ref={menuRef}
                role="menu"
                aria-label={t('moreMenu')}
                // `end-0` not `right-0`: in Arabic the menu has to hang off the
                // opposite edge or it opens off-screen.
                className="absolute end-0 top-full z-40 mt-1 w-56 rounded-xl border border-neutral-200 bg-white p-2 text-neutral-800 shadow-lg"
              >
                <Link
                  href={`/${locale}/resume`}
                  role="menuitem"
                  className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                >
                  <ScrollText className="size-5 shrink-0" aria-hidden="true" />
                  {tNav('resumeBuilder')}
                </Link>

                <div className="my-1 border-t border-neutral-100" />

                {/* The existing switcher, light variant — the same control the
                    desktop sidebar uses, not a reimplementation. */}
                <div className="px-1 py-1">
                  <LanguageSwitcher variant="light" className="w-full" />
                </div>

                <div className="my-1 border-t border-neutral-100" />

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    requestLogout();
                  }}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-neutral-700 hover:bg-error-bg hover:text-error-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                >
                  <LogOut className="size-5 shrink-0" aria-hidden="true" />
                  {tNav('logout')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <form onSubmit={onSearchSubmit} role="search" className="px-3 pb-3 pt-2">
        <label htmlFor="app-search" className="sr-only">
          {t('searchLabel')}
        </label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-neutral-600"
          >
            <Search className="size-4" />
          </span>
          <input
            id="app-search"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            // eslint-disable-next-line no-restricted-syntax -- PLACEHOLDER text, which WCAG 1.4.3 exempts and the rule names as exempt. The value the user types is text-neutral-900; keeping the placeholder lighter is what distinguishes a hint from an entry.
            className="h-11 w-full rounded-xl border border-white/20 bg-white ps-10 pe-3 text-sm text-neutral-900 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/60"
          />
        </div>
      </form>
    </header>
  );
}
