'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Bell, Building2, ChevronDown, LogOut, User } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { useLogoutConfirm } from '@/lib/auth/logout-confirm';
import { useEmployer } from '@/lib/employer/employer-context';
import { cn } from '@/lib/utils';
import { LOCALES, isLocale, type Locale } from '@/i18n/locales';

/**
 * Same control and same reasoning as the candidate-side `LanguageSwitcher`: the
 * locale list comes from the registry (`@/i18n/locales`) instead of a local
 * copy, and a native `<select>` replaces the button row because fifteen
 * languages do not fit in a header.
 */
function HeaderLangSwitcher() {
  const currentLocale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function switchLocale(newLocale: Locale) {
    if (newLocale === currentLocale) return;
    const segments = pathname.split('/').filter(Boolean);
    if (isLocale(segments[0])) {
      segments[0] = newLocale;
    } else {
      segments.unshift(newLocale);
    }
    router.push('/' + segments.join('/'));
  }

  return (
    <div className="relative inline-flex items-center">
      <select
        aria-label="Select language / भाषा चुनें"
        value={currentLocale}
        onChange={(e) => switchLocale(e.target.value as Locale)}
        className={cn(
          'h-9 cursor-pointer appearance-none rounded-lg ps-2.5 pe-7 text-xs font-semibold',
          'border border-neutral-200 bg-white text-neutral-700 transition-colors',
          'hover:border-[#0F3D91]/40 hover:text-[#0F3D91]',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
        )}
      >
        {LOCALES.map(({ code, nativeName }) => (
          <option key={code} value={code}>
            {nativeName}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute end-2 size-3.5 text-neutral-600"
        aria-hidden="true"
      />
    </div>
  );
}

export function EmployerHeader({ onMenuClick }: { onMenuClick?: () => void }) {
  const t = useTranslations('employer');
  const { requestLogout } = useLogoutConfirm();
  const { user } = useAuth();
  const { company } = useEmployer();
  // Needed by the notifications link. Sourced from next-intl (already imported
  // for the language switcher) rather than re-adding a useParams read.
  const locale = useLocale();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const displayName = company?.name ?? user?.email ?? '';
  const companyInitials = (company?.name ?? user?.email ?? '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  // Same dismissal contract as the candidate chip: Escape, or a click anywhere
  // outside. The previous onBlur-only version left the menu stuck open whenever
  // focus never entered it — a mouse user clicking the page background.
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
    <header className="sticky top-0 z-20 flex items-center justify-between h-16 px-4 sm:px-6 bg-white/90 backdrop-blur-md border-b border-neutral-200/70 shadow-sm">
      {/* Left: hamburger trigger (mobile) + company name */}
      <div className="flex items-center gap-3 min-w-0">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label={t('nav.openSidebar')}
            className="lg:hidden flex items-center justify-center size-10 rounded-xl text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 shrink-0"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="3" y1="5" x2="17" y2="5" />
              <line x1="3" y1="10" x2="17" y2="10" />
              <line x1="3" y1="15" x2="17" y2="15" />
            </svg>
          </button>
        )}
        {displayName && (
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0F3D91] to-[#2E67B1] text-xs font-bold text-white sm:flex"
            >
              {companyInitials || <Building2 className="size-4" />}
            </span>
            <span
              className="text-sm font-semibold text-neutral-800 truncate max-w-[10rem] sm:max-w-xs"
              data-testid="header-company-name"
            >
              {displayName}
            </span>
          </span>
        )}
      </div>

      {/* Right: lang switcher, notifications, account menu */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="hidden sm:block rounded-xl bg-neutral-100/70 p-0.5">
          <HeaderLangSwitcher />
        </div>

        {/* Notifications — links to the employer notifications page */}
        <Link
          href={`/${locale}/employer/notifications`}
          aria-label={t('header.notifications')}
          className="relative flex items-center justify-center size-10 rounded-xl text-neutral-600 ring-1 ring-neutral-200/70 transition-all hover:text-[#0F3D91] hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          <Bell className="size-5" aria-hidden="true" />
        </Link>

        {/* Account menu — deliberately the same shape as the candidate chip in
            DashboardHeader: an identity chip that opens a compact actions menu,
            closing on Escape or an outside click. */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t('header.accountMenu')}
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2.5 rounded-full bg-white/80 py-1.5 pe-2 ps-1.5 shadow-sm ring-1 ring-neutral-200/70 transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0F3D91] to-[#2E67B1] text-xs font-bold text-white"
            >
              {companyInitials || <Building2 className="size-4" />}
            </span>
            {/* The COMPANY, not the mailbox — "hr@gulfstar.ex…" said nothing
                about which account you were operating. Shown here and ONLY
                here: the menu below is actions only, so the name never appears
                twice. */}
            <span className="hidden max-w-[140px] truncate text-start text-sm font-semibold text-neutral-900 sm:block">
              {displayName}
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
              aria-label={t('header.accountMenu')}
              // Compact menu, right-aligned under the chip — the company name
              // already lives on the chip, so the dropdown is just the actions.
              // Same geometry as the candidate menu in DashboardHeader, one step
              // wider: that one is sized for the single word "Profile", and
              // "Company Profile" wraps to two lines at w-44.
              className="absolute end-0 top-[calc(100%+0.5rem)] z-30 w-52 overflow-hidden rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl"
            >
              <Link
                href={`/${locale}/employer/profile`}
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
              >
                <User className="size-4 shrink-0" aria-hidden="true" />
                {t('nav.profile')}
              </Link>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  requestLogout();
                }}
                className="flex w-full items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium text-error-fg transition-colors hover:bg-error-bg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
              >
                <LogOut className="size-4 shrink-0" aria-hidden="true" />
                {t('header.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
