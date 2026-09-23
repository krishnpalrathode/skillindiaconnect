'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bell, LogOut, ScrollText, User } from 'lucide-react';
import { LanguageSwitcher } from '@/components/auth/LanguageSwitcher';
import { Avatar } from '@/components/ui/avatar';
import { useLogoutConfirm } from '@/lib/auth/logout-confirm';
import { useUnreadCount } from '@/lib/notifications/useUnreadCount';
import { useMe } from '@/lib/candidate/useMe';
import { cn } from '@/lib/utils';

/**
 * Dark app header — PHONE WIDTHS ONLY (`lg:hidden`).
 *
 * Layout: brand logo on the start side; on the end side the notification bell
 * and the user AVATAR (initials/photo + a green presence dot when available),
 * which opens the account menu (Profile, Resume Builder, language, sign-out).
 * The avatar moved up here from the dashboard greeting so it is reachable on
 * every screen, and the greeting can stay clean.
 *
 * ── Why the navy is a token ──────────────────────────────────────────────────
 * `primary-700` (#1a3c6e) is the brand anchor AND the manifest `theme_color`.
 * In an installed TWA the status bar takes the manifest colour, so bar and
 * header meet edge to edge; both from one token stops a seam appearing later.
 */
export function MobileAppHeader({ locale }: { locale: string }) {
  const t = useTranslations('appShell');
  const tNav = useTranslations('nav');
  const pathname = usePathname();
  const { requestLogout } = useLogoutConfirm();
  const { count } = useUnreadCount();
  const me = useMe();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  /*
    Close on NAVIGATION, not in the link's own onClick — closing in onClick
    unmounts the <Link> during the click that is supposed to follow it, and the
    navigation can be lost with it. Reacting to the route change instead lets the
    link survive its own click while the menu still closes at the destination.
  */
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Close on an outside tap or Escape. A menu that can only be dismissed by
  // choosing from it is a trap on touch, where there is no "click away" instinct.
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

  // Counts are capped for LAYOUT, but the accessible name always carries the
  // true number — a screen-reader user should never be told "99+".
  const badgeText = count > 99 ? '99+' : String(count);
  const bellLabel = count > 0 ? t('notificationsWithCount', { count }) : t('notificationsNone');

  return (
    <header className="lg:hidden sticky top-0 z-30 bg-primary-700 text-white">
      <div className="flex items-center gap-2 px-3 py-3">
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

          {/* User avatar + account menu */}
          <div className="relative">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={t('accountMenu')}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="flex size-11 items-center justify-center rounded-full transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/60"
            >
              <span className="relative block">
                <Avatar name={me.name || '—'} photoUrl={me.photoUrl} className="size-9 text-sm" />
                {me.isAvailable && (
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-0.5 -end-0.5 size-3 rounded-full bg-success ring-2 ring-primary-700"
                  />
                )}
              </span>
            </button>

            {menuOpen && (
              <div
                ref={menuRef}
                role="menu"
                aria-label={t('accountMenu')}
                // `end-0` not `right-0`: in Arabic the menu has to hang off the
                // opposite edge or it opens off-screen.
                className="absolute end-0 top-full z-40 mt-1 w-56 rounded-xl border border-neutral-200 bg-white p-2 text-neutral-800 shadow-lg"
              >
                <Link
                  href={`/${locale}/profile`}
                  role="menuitem"
                  className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                >
                  <User className="size-5 shrink-0" aria-hidden="true" />
                  {tNav('profile')}
                </Link>

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
    </header>
  );
}
