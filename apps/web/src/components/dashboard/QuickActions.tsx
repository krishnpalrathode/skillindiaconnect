'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { UserCheck, Briefcase, Bell, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function QuickActions() {
  const t = useTranslations('dashboard.quickActions');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  const actions = [
    {
      href: `/${locale}/profile`,
      icon: <UserCheck className="size-5" aria-hidden="true" />,
      label: t('completeProfile'),
      iconClassName: 'bg-[#E8F0FE] text-[#0F3D91]',
    },
    {
      href: `/${locale}/jobs`,
      icon: <Briefcase className="size-5" aria-hidden="true" />,
      label: t('browseJobs'),
      iconClassName: 'bg-accent-100 text-accent-600',
    },
    {
      href: `/${locale}/notifications`,
      icon: <Bell className="size-5" aria-hidden="true" />,
      label: t('viewNotifications'),
      iconClassName: 'bg-[#F3E8FF] text-[#7C3AED]',
    },
  ];

  return (
    <section aria-labelledby="quick-actions-heading">
      <h2 id="quick-actions-heading" className="mb-3 text-base font-bold text-neutral-900">
        {t('title')}
      </h2>
      <div className="flex flex-col gap-2.5">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group flex items-center gap-3 rounded-2xl border border-neutral-200/70 bg-white px-4 py-3 text-sm font-semibold text-neutral-800 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[#0F3D91]/20 hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <span
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-xl',
                action.iconClassName,
              )}
            >
              {action.icon}
            </span>
            <span className="flex-1">{action.label}</span>
            <ChevronRight
              className="size-4 shrink-0 text-neutral-600 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        ))}
      </div>
    </section>
  );
}
