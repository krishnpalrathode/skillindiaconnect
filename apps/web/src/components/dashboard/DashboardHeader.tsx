'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Bell, ChevronDown, LogOut, User } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { cn } from '@/lib/utils';

interface DashboardHeaderProps {
  /** Full name (or email fallback) — used for the greeting first-name and the chip. */
  name: string;
  isAvailable: boolean;
  unreadCount: number;
  locale: string;
}

/**
 * Dashboard top bar: greeting + subtitle on the start side, a notification bell
 * and a user-menu chip on the end side. Purely presentational — the bell links to
 * the existing /notifications route and the menu reuses the existing auth logout.
 */
export function DashboardHeader({ name, isAvailable, unreadCount, locale }: DashboardHeaderProps) {
  const t = useTranslations('dashboard');
  const tNav = useTranslations('nav');
  const { logout } = useAuth();
  const router = useRouter();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const firstName = name.split(' ')[0] ?? name;
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-2xl sm:text-3xl font-bold text-neutral-900 tracking-tight">
          {t('greeting', { name: firstName })}
          <span aria-hidden="true" className="text-2xl sm:text-3xl">
            👋
          </span>
        </h1>
        <p className="mt-1 text-sm text-neutral-600">{t('subtitle')}</p>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {/* Notification bell */}
        <Link
          href={`/${locale}/notifications`}
          aria-label={
            unreadCount > 0 ? `${tNav('notifications')} (${unreadCount})` : tNav('notifications')
          }
          className="relative inline-flex size-11 items-center justify-center rounded-full bg-white/80 text-neutral-600 shadow-sm ring-1 ring-neutral-200/70 transition-all hover:text-[#0F3D91] hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          <Bell className="size-5" aria-hidden="true" />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute end-2.5 top-2.5 size-2.5 rounded-full bg-[#F57C20] ring-2 ring-white"
            />
          )}
        </Link>

        {/* User chip + menu */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-2.5 rounded-full bg-white/80 py-1.5 pe-2 ps-1.5 shadow-sm ring-1 ring-neutral-200/70 transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <span className="relative shrink-0">
              <span
                aria-hidden="true"
                className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-[#0F3D91] to-[#2E67B1] text-sm font-semibold text-white"
              >
                {initials || <User className="size-4" />}
              </span>
              {/* Availability as a presence dot (mirrors the notification dot),
                  not a text label — cleaner and keeps the chip single-line. */}
              {isAvailable && (
                <span
                  aria-hidden="true"
                  className="absolute -bottom-0.5 -end-0.5 size-3 rounded-full bg-success ring-2 ring-white"
                />
              )}
            </span>
            <span className="hidden max-w-[140px] truncate text-start text-sm font-semibold text-neutral-900 sm:block">
              {name}
              {isAvailable && <span className="sr-only"> — Available</span>}
            </span>
            <ChevronDown
              className={cn(
                'size-4 shrink-0 text-neutral-600 transition-transform',
                menuOpen && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </button>

          {menuOpen && (
            <div
              role="menu"
              // Compact menu, right-aligned under the chip — the name already
              // lives on the chip, so the dropdown is just the actions.
              className="absolute end-0 top-[calc(100%+0.5rem)] z-20 w-44 overflow-hidden rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl"
            >
              <Link
                href={`/${locale}/profile`}
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
              >
                <User className="size-4 shrink-0" aria-hidden="true" />
                {tNav('profile')}
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  logout().then(() => router.replace(`/${locale}/login`));
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-error-fg transition-colors hover:bg-error-bg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
              >
                <LogOut className="size-4 shrink-0" aria-hidden="true" />
                {tNav('logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
