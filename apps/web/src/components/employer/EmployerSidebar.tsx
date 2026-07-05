'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { LayoutDashboard, PlusCircle, Briefcase, Users, CreditCard, User } from 'lucide-react';
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
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-neutral-400 cursor-not-allowed select-none min-h-[44px]"
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
        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px]',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
        active
          ? 'bg-primary-50 text-primary-700'
          : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
      )}
    >
      <span className="size-5 shrink-0" aria-hidden="true">
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

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-neutral-100 shrink-0">
        <Link
          href={`/${locale}/employer/dashboard`}
          onClick={onNavClick}
          className="text-lg font-bold text-primary-700 tracking-tight focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          SkillIndiaConnect
        </Link>
      </div>

      {/* Nav links */}
      <nav
        className="flex-1 px-2 py-4 flex flex-col gap-0.5 overflow-y-auto"
        aria-label={t('nav.ariaLabel')}
      >
        {navItems.map((item) => (
          <NavItem
            key={item.key}
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={pathname.startsWith(item.href)}
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
