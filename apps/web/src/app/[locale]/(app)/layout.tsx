'use client';

import React, { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, usePathname, useParams } from 'next/navigation';
import { User, Briefcase, FileText, Bell, Settings, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
}

function NavItem({ href, icon, label, active, disabled }: NavItemProps) {
  if (disabled) {
    return (
      <span
        aria-label={`${label} — coming soon`}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-neutral-400 cursor-not-allowed select-none"
      >
        <span className="size-5 shrink-0 opacity-50">{icon}</span>
        <span className="hidden lg:block">{label}</span>
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
        active
          ? 'bg-primary-50 text-primary-700'
          : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
      )}
    >
      <span className="size-5 shrink-0">{icon}</span>
      <span className="hidden lg:block">{label}</span>
    </Link>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('nav');
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace(`/${locale}/login`);
    }
  }, [user, isLoading, router, locale]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-neutral-50">
        <Spinner size={32} label="Loading…" />
      </div>
    );
  }

  const isProfile = pathname.includes('/profile');

  const navItems = [
    {
      href: `/${locale}/profile`,
      icon: <User className="size-5" aria-hidden="true" />,
      label: t('profile'),
      active: isProfile,
    },
    {
      href: `/${locale}/jobs`,
      icon: <Briefcase className="size-5" aria-hidden="true" />,
      label: t('jobs'),
      disabled: true,
    },
    {
      href: `/${locale}/applications`,
      icon: <FileText className="size-5" aria-hidden="true" />,
      label: t('applications'),
      disabled: true,
    },
    {
      href: `/${locale}/notifications`,
      icon: <Bell className="size-5" aria-hidden="true" />,
      label: t('notifications'),
      disabled: true,
    },
    {
      href: `/${locale}/settings`,
      icon: <Settings className="size-5" aria-hidden="true" />,
      label: t('settings'),
      disabled: true,
    },
  ];

  return (
    <div className="min-h-svh bg-neutral-50 lg:flex">
      {/* ── Desktop sidebar ──────────────────────────────────────────── */}
      <aside className="hidden lg:flex lg:flex-col lg:w-56 xl:w-64 lg:shrink-0 lg:fixed lg:inset-y-0 lg:start-0 border-e border-neutral-200 bg-white z-10">
        {/* Logo */}
        <div className="flex items-center h-16 px-4 border-b border-neutral-100">
          <span className="text-lg font-bold text-primary-700 tracking-tight">
            SkillIndiaConnect
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-2 py-4 flex flex-col gap-1" aria-label="Main navigation">
          {navItems.map((item) => (
            <NavItem key={item.href} {...item} />
          ))}
        </nav>

        {/* Logout */}
        <div className="px-2 py-4 border-t border-neutral-100">
          <button
            type="button"
            onClick={() => logout().then(() => router.replace(`/${locale}/login`))}
            className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <LogOut className="size-5 shrink-0" aria-hidden="true" />
            <span className="hidden lg:block">{t('logout')}</span>
          </button>
        </div>
      </aside>

      {/* ── Mobile top header ─────────────────────────────────────────── */}
      <header className="lg:hidden sticky top-0 z-10 flex items-center justify-between h-14 px-4 bg-white border-b border-neutral-200 shadow-sm">
        <span className="text-base font-bold text-primary-700 tracking-tight">
          SkillIndiaConnect
        </span>
        <button
          type="button"
          onClick={() => logout().then(() => router.replace(`/${locale}/login`))}
          aria-label={t('logout')}
          className="flex items-center justify-center size-9 rounded-lg text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          <LogOut className="size-5" aria-hidden="true" />
        </button>
      </header>

      {/* ── Main content ──────────────────────────────────────────────── */}
      <main className="flex-1 lg:ms-56 xl:ms-64 pb-20 lg:pb-0">{children}</main>

      {/* ── Mobile bottom nav ────────────────────────────────────────── */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-10 flex items-center justify-around bg-white border-t border-neutral-200 h-16 px-2"
        aria-label="Main navigation"
      >
        {navItems.slice(0, 4).map((item) =>
          item.disabled ? (
            <span
              key={item.href}
              className="flex flex-col items-center gap-0.5 px-2 py-1 text-neutral-400 cursor-not-allowed select-none"
            >
              <span className="size-5 opacity-50">{item.icon}</span>
              <span className="text-[10px]">{item.label}</span>
            </span>
          ) : (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg min-h-[44px] justify-center',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
                item.active ? 'text-primary-700' : 'text-neutral-500',
              )}
            >
              {item.icon}
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          ),
        )}
      </nav>
    </div>
  );
}
