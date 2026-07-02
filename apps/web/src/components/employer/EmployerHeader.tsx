'use client';

import React, { useRef, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { Bell, ChevronDown, LogOut, User } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { useEmployer } from '@/lib/employer/employer-context';
import { cn } from '@/lib/utils';

const LOCALES = [
  { code: 'en', label: 'EN' },
  { code: 'hi', label: 'हि' },
  { code: 'ar', label: 'ع' },
] as const;

type LocaleCode = (typeof LOCALES)[number]['code'];
const ALL_LOCALE_CODES = LOCALES.map((l) => l.code);

function HeaderLangSwitcher() {
  const currentLocale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function switchLocale(newLocale: LocaleCode) {
    if (newLocale === currentLocale) return;
    const segments = pathname.split('/').filter(Boolean);
    if (ALL_LOCALE_CODES.includes(segments[0] as LocaleCode)) {
      segments[0] = newLocale;
    } else {
      segments.unshift(newLocale);
    }
    router.push('/' + segments.join('/'));
  }

  return (
    <div className="flex gap-0.5" role="group" aria-label="Select language">
      {LOCALES.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          onClick={() => switchLocale(code)}
          aria-pressed={currentLocale === code}
          aria-label={`Switch language to ${code}`}
          className={cn(
            'px-2 py-1 rounded text-xs font-medium transition-colors min-w-[2rem] h-8',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
            currentLocale === code
              ? 'bg-primary-100 text-primary-800'
              : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function EmployerHeader({ onMenuClick }: { onMenuClick?: () => void }) {
  const t = useTranslations('employer');
  const { user, logout } = useAuth();
  const { company } = useEmployer();
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const displayName = company?.name ?? user?.email ?? '';

  function handleLogout() {
    logout().then(() => router.replace(`/${locale}/login`));
  }

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between h-16 px-4 bg-white border-b border-neutral-200 shadow-sm">
      {/* Left: hamburger trigger (mobile) + company name */}
      <div className="flex items-center gap-3 min-w-0">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label={t('nav.openSidebar')}
            className="lg:hidden flex items-center justify-center size-9 rounded-lg text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 shrink-0"
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
          <span
            className="text-sm font-semibold text-neutral-800 truncate max-w-[10rem] sm:max-w-xs"
            data-testid="header-company-name"
          >
            {displayName}
          </span>
        )}
      </div>

      {/* Right: lang switcher, notifications, account menu */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="hidden sm:block">
          <HeaderLangSwitcher />
        </div>

        {/* Notifications bell — stub; no endpoint in S2 */}
        <button
          type="button"
          aria-label={t('header.notifications')}
          className="relative flex items-center justify-center size-9 rounded-lg text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          <Bell className="size-5" aria-hidden="true" />
        </button>

        {/* Account menu */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t('header.accountMenu')}
            onClick={() => setMenuOpen((o) => !o)}
            onBlur={(e) => {
              if (!menuRef.current?.contains(e.relatedTarget as Node)) {
                setMenuOpen(false);
              }
            }}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 min-h-[36px]"
          >
            <User className="size-4" aria-hidden="true" />
            <span className="hidden sm:block max-w-[7rem] truncate">{user?.email}</span>
            <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              aria-label={t('header.accountMenu')}
              className="absolute end-0 mt-1 w-44 rounded-lg bg-white border border-neutral-200 shadow-lg py-1 z-30"
            >
              <button
                role="menuitem"
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-[2px] focus-visible:ring-ring/70 min-h-[40px]"
              >
                <LogOut className="size-4" aria-hidden="true" />
                {t('header.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
