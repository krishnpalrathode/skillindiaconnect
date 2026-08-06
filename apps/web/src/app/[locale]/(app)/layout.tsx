'use client';

import React, { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname, useParams } from 'next/navigation';
import {
  User,
  Briefcase,
  FileText,
  Bell,
  Settings,
  LogOut,
  LayoutDashboard,
  ScrollText,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { useLogoutConfirm } from '@/lib/auth/logout-confirm';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  /**
   * Optional shorter label for the MOBILE bottom bar only.
   *
   * The bar went from 4 items to 5 (CR-001: Resume Builder is a core
   * destination and displacing Notifications to make room would have traded one
   * discoverability win for a regression). Five items on a 360px device leaves
   * ~72px each — ample for a 44px touch target, but not for a 13-character word
   * at 10px. The constraint is LABEL WIDTH, not tap area, so the fix is a
   * shorter word on mobile rather than smaller text or a truncated one.
   *
   * The desktop sidebar always renders the full `label`.
   */
  shortLabel?: string;
  active?: boolean;
  disabled?: boolean;
}

function NavItem({ href, icon, label, active, disabled }: NavItemProps) {
  if (disabled) {
    return (
      <span
        aria-label={`${label} — coming soon`}
        // eslint-disable-next-line no-restricted-syntax -- DISABLED control — WCAG 1.4.3 explicitly exempts disabled UI, and darkening it would stop it reading as unavailable.
        className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-neutral-400 cursor-not-allowed select-none"
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
        'group flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
        active
          ? 'bg-gradient-to-r from-[#0F3D91] to-[#2E67B1] text-white shadow-lg shadow-[#0F3D91]/25'
          : 'text-neutral-600 hover:bg-white hover:text-[#0F3D91] hover:shadow-sm',
      )}
    >
      <span
        className={cn(
          'size-5 shrink-0 transition-transform duration-200',
          !active && 'group-hover:scale-110',
        )}
      >
        {icon}
      </span>
      <span className="hidden lg:block">{label}</span>
    </Link>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('nav');
  const { requestLogout } = useLogoutConfirm();
  const { user, isLoading, isLoggingOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  // /jobs (search + detail) is public — browsable unauthenticated for SEO/guests.
  // Every other route in this group is candidate-only.
  const isPublicPath = pathname.includes('/jobs');

  useEffect(() => {
    // `isLoggingOut` — a deliberate sign-out owns its own redirect (to the
    // landing page). Without this check the guard fires the instant `user`
    // clears and races it, dumping the user back on /login.
    if (!isLoading && !user && !isPublicPath && !isLoggingOut) {
      router.replace(`/${locale}/login`);
    }
  }, [user, isLoading, isLoggingOut, router, locale, isPublicPath]);

  // Guest (or auth still resolving) on a public path: render the page as-is,
  // no sidebar chrome and no blocking spinner — SSR content must never be
  // hidden behind a client-only auth gate (see mock-setup.tsx for the same rule).
  if (isPublicPath && !user) {
    return <>{children}</>;
  }

  if (isLoading || !user) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-neutral-50">
        <Spinner size={32} label="Loading…" />
      </div>
    );
  }

  const isDashboard = pathname.endsWith('/dashboard');
  const isProfile = pathname.includes('/profile');
  const isNotifications = pathname.includes('/notifications');
  const isResume = pathname.includes('/resume');
  const isSettings = pathname.includes('/settings');

  // Explicitly typed: nothing is `disabled` right now, so inference would drop
  // that property from the union and break the mobile nav's disabled branch —
  // which is still the supported way to add a not-yet-built item.
  const navItems: NavItemProps[] = [
    {
      href: `/${locale}/dashboard`,
      icon: <LayoutDashboard className="size-5" aria-hidden="true" />,
      label: t('dashboard'),
      active: isDashboard,
    },
    {
      href: `/${locale}/profile`,
      icon: <User className="size-5" aria-hidden="true" />,
      label: t('profile'),
      active: isProfile,
    },
    {
      // CR-001: the resume builder is a first-class destination, not a step
      // buried inside onboarding. Positioned immediately after Profile because
      // the resume is built FROM the profile — to a candidate they are one
      // task, and separating them in the nav would imply otherwise.
      href: `/${locale}/resume`,
      icon: <ScrollText className="size-5" aria-hidden="true" />,
      label: t('resumeBuilder'),
      shortLabel: t('resumeBuilderShort'),
      active: isResume,
    },
    {
      href: `/${locale}/jobs`,
      icon: <Briefcase className="size-5" aria-hidden="true" />,
      label: t('jobs'),
      active: pathname.includes('/jobs'),
    },
    {
      href: `/${locale}/notifications`,
      icon: <Bell className="size-5" aria-hidden="true" />,
      label: t('notifications'),
      // "Notifications" is 13 characters and was already the tightest label in
      // the bar at four items; at five it no longer fits on one line at 360px.
      // Shortened on MOBILE ONLY — the sidebar still says Notifications.
      shortLabel: t('notificationsShort'),
      active: isNotifications,
    },
    {
      href: `/${locale}/applications`,
      icon: <FileText className="size-5" aria-hidden="true" />,
      label: t('applications'),
      active: pathname.includes('/applications'),
    },
    {
      // Settings now has its OWN route rather than deep-linking to
      // /profile#account-settings. That deep link loaded the whole profile page
      // and lit up "Profile" in the nav, so this item could never read as
      // current — the URL it landed on was the profile route. The page is a thin
      // wrapper mounting the SAME AccountSettingsSection the profile page uses,
      // so there is still one implementation of the controls.
      href: `/${locale}/settings`,
      icon: <Settings className="size-5" aria-hidden="true" />,
      label: t('settings'),
      active: isSettings,
    },
  ];

  return (
    <div className="min-h-svh bg-[#F5F8FC] lg:flex">
      {/* ── Desktop sidebar ──────────────────────────────────────────── */}
      <aside className="hidden lg:flex lg:flex-col lg:w-56 xl:w-64 lg:shrink-0 lg:fixed lg:inset-y-0 lg:start-0 border-e border-neutral-200/70 bg-white/95 backdrop-blur-sm z-10">
        {/* Logo — object-cover crops the artwork band out of the logo's gray
            canvas (same treatment as the login screen) so it reads large. */}
        <div className="flex items-center justify-center h-28 px-4 border-b border-neutral-100">
          <div className="relative h-20 w-full overflow-hidden rounded-lg">
            <Image
              src="/brand/logo.png"
              alt="SkillIndia Connect"
              fill
              priority
              sizes="256px"
              className="object-cover object-center"
            />
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-5 flex flex-col gap-1.5" aria-label="Main navigation">
          {navItems.map((item) => (
            <NavItem key={item.href} {...item} />
          ))}
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-neutral-100">
          <button
            type="button"
            onClick={requestLogout}
            className="flex w-full items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-neutral-600 hover:bg-error-bg hover:text-error-fg transition-all duration-200 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <LogOut className="size-5 shrink-0" aria-hidden="true" />
            <span className="hidden lg:block">{t('logout')}</span>
          </button>
        </div>
      </aside>

      {/* ── Mobile top header ─────────────────────────────────────────── */}
      <header className="lg:hidden sticky top-0 z-10 flex items-center justify-between h-16 px-4 bg-white/95 backdrop-blur-sm border-b border-neutral-200 shadow-sm">
        <div className="relative h-11 w-36 overflow-hidden rounded-md">
          <Image
            src="/brand/logo.png"
            alt="SkillIndia Connect"
            fill
            priority
            sizes="144px"
            className="object-cover object-center"
          />
        </div>
        <button
          type="button"
          onClick={requestLogout}
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
        {navItems.slice(0, 5).map((item) =>
          item.disabled ? (
            <span
              key={item.href}
              // eslint-disable-next-line no-restricted-syntax -- DISABLED control — WCAG 1.4.3 explicitly exempts disabled UI, and darkening it would stop it reading as unavailable.
              className="flex flex-1 min-w-0 flex-col items-center gap-0.5 px-1 py-1 text-neutral-400 cursor-not-allowed select-none"
            >
              <span className="size-5 opacity-50">{item.icon}</span>
              <span className="max-w-full truncate text-[10px]">
                {item.shortLabel ?? item.label}
              </span>
            </span>
          ) : (
            <Link
              key={item.href}
              href={item.href}
              // The accessible name stays the FULL label — a screen reader must
              // announce "Resume Builder", never the abbreviated bar text.
              aria-label={item.label}
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                // flex-1 + min-w-0: five equal columns that cannot overflow the
                // bar. At 360px that is ~72px each — comfortably past the 44px
                // minimum target, with min-h-[44px] guaranteeing the vertical.
                'flex flex-1 min-w-0 flex-col items-center gap-0.5 px-1 py-1 rounded-xl min-h-[44px] justify-center transition-colors',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
                item.active
                  ? 'bg-gradient-to-r from-[#0F3D91] to-[#2E67B1] text-white shadow-md shadow-[#0F3D91]/25'
                  : 'text-neutral-600',
              )}
            >
              {item.icon}
              <span aria-hidden="true" className="max-w-full truncate text-[10px] font-medium">
                {item.shortLabel ?? item.label}
              </span>
            </Link>
          ),
        )}
      </nav>
    </div>
  );
}
