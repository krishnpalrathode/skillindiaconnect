'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useParams } from 'next/navigation';
import {
  LayoutDashboard,
  PlusCircle,
  Briefcase,
  Users,
  Bell,
  CreditCard,
  User,
} from 'lucide-react';
import { useEmployer } from '@/lib/employer/employer-context';
import { PlanStatusWidget } from './PlanStatusWidget';
import { cn } from '@/lib/utils';

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick?: () => void;
}

function NavItem({ href, icon, label, active, disabled, disabledReason, onClick }: NavItemProps) {
  if (disabled) {
    return (
      <span
        role="button"
        aria-disabled="true"
        aria-label={disabledReason ? `${label} — ${disabledReason}` : label}
        title={disabledReason}
        // eslint-disable-next-line no-restricted-syntax -- DISABLED control — WCAG 1.4.3 explicitly exempts disabled UI, and darkening it would stop it reading as unavailable.
        className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-neutral-400 cursor-not-allowed select-none min-h-[44px]"
      >
        <span className="size-5 shrink-0 opacity-50" aria-hidden="true">
          {icon}
        </span>
        <span>{label}</span>
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'group flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 min-h-[44px]',
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
        aria-hidden="true"
      >
        {icon}
      </span>
      <span>{label}</span>
    </Link>
  );
}

interface EmployerSidebarProps {
  /** Called when a nav item is clicked (lets the layout close the mobile drawer) */
  onNavClick?: () => void;
}

export function EmployerSidebar({ onNavClick }: EmployerSidebarProps) {
  const t = useTranslations('employer');
  const pathname = usePathname();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';
  const { company } = useEmployer();

  const isApproved = company?.status === 'APPROVED';
  const pendingHint = t('nav.postJobPendingHint');

  const currentPath = pathname ?? '';

  const navItems = [
    {
      href: `/${locale}/employer/dashboard`,
      icon: <LayoutDashboard className="size-5" />,
      label: t('nav.dashboard'),
      key: 'dashboard',
    },
    {
      href: `/${locale}/employer/jobs/new`,
      icon: <PlusCircle className="size-5" />,
      label: t('nav.postJob'),
      key: 'jobs-new',
      disabled: !isApproved,
      disabledReason: !isApproved ? pendingHint : undefined,
    },
    {
      href: `/${locale}/employer/jobs`,
      icon: <Briefcase className="size-5" />,
      label: t('nav.myJobs'),
      key: 'jobs',
    },
    {
      href: `/${locale}/employer/candidates`,
      icon: <Users className="size-5" />,
      label: t('nav.candidates'),
      key: 'candidates',
    },
    {
      href: `/${locale}/employer/notifications`,
      icon: <Bell className="size-5" />,
      label: t('nav.notifications'),
      key: 'notifications',
    },
    {
      href: `/${locale}/employer/subscription`,
      icon: <CreditCard className="size-5" />,
      label: t('nav.subscription'),
      key: 'subscription',
    },
    {
      href: `/${locale}/employer/profile`,
      icon: <User className="size-5" />,
      label: t('nav.profile'),
      key: 'profile',
    },
  ];

  // Active = the nav item whose href is the LONGEST prefix of the current path.
  // A plain `startsWith` lights up BOTH "My Jobs" (/employer/jobs) and the more
  // specific "Post a Job" (/employer/jobs/new) on the new-job route; picking the
  // longest match makes the specific item win, while "My Jobs" still stays active
  // on job detail routes (/employer/jobs/:id).
  const matchedHrefs = navItems
    .map((item) => item.href)
    .filter((href) => currentPath === href || currentPath.startsWith(`${href}/`));
  const activeHref = matchedHrefs.length
    ? matchedHrefs.reduce((longest, href) => (href.length > longest.length ? href : longest))
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Logo — object-cover crops the artwork band out of the logo's canvas
          (same treatment as the candidate shell) so it reads large. */}
      <div className="flex items-center justify-center h-28 px-4 border-b border-neutral-100 shrink-0">
        <Link
          href={`/${locale}/employer/dashboard`}
          onClick={onNavClick}
          className="relative block h-20 w-full overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          <Image
            src="/brand/logo.png"
            alt="SkillIndia Connect"
            fill
            priority
            sizes="256px"
            className="object-cover object-center"
          />
        </Link>
      </div>

      {/* Nav links */}
      <nav
        className="flex-1 px-3 py-5 flex flex-col gap-1.5 overflow-y-auto"
        aria-label={t('nav.ariaLabel')}
      >
        {navItems.map((item) => (
          <NavItem
            key={item.key}
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={item.href === activeHref}
            disabled={item.disabled}
            disabledReason={item.disabledReason}
            onClick={onNavClick}
          />
        ))}
      </nav>

      {/* Plan widget */}
      <PlanStatusWidget />
    </div>
  );
}
