'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { UserCheck, Briefcase, Bell } from 'lucide-react';

export function QuickActions() {
  const t = useTranslations('dashboard.quickActions');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  const actions = [
    {
      href: `/${locale}/profile`,
      icon: <UserCheck className="size-5" aria-hidden="true" />,
      label: t('completeProfile'),
    },
    {
      href: `/${locale}/jobs`,
      icon: <Briefcase className="size-5" aria-hidden="true" />,
      label: t('browseJobs'),
    },
    {
      href: `/${locale}/notifications`,
      icon: <Bell className="size-5" aria-hidden="true" />,
      label: t('viewNotifications'),
    },
  ];

  return (
    <section aria-labelledby="quick-actions-heading">
      <h2 id="quick-actions-heading" className="text-base font-semibold text-neutral-900 mb-3">
        {t('title')}
      </h2>
      <div className="flex flex-col gap-2">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="flex items-center gap-3 bg-white rounded-lg border border-neutral-200 px-4 py-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            <span className="text-primary-600">{action.icon}</span>
            {action.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
