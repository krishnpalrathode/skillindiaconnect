'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ShieldCheck, BadgeCheck, Globe } from 'lucide-react';
import { LanguageSwitcher } from '@/components/auth/LanguageSwitcher';
import { EmployerLoginForm } from '@/components/employer/EmployerLoginForm';

export default function EmployerLoginPage() {
  const t = useTranslations('employer.login');

  const trustBadges = [
    { icon: <BadgeCheck className="size-4" aria-hidden="true" />, label: t('trustBadge1') },
    { icon: <ShieldCheck className="size-4" aria-hidden="true" />, label: t('trustBadge2') },
    { icon: <Globe className="size-4" aria-hidden="true" />, label: t('trustBadge3') },
  ];

  return (
    <div className="min-h-svh flex">
      {/* Hero panel — hidden on mobile */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-gradient-to-br from-primary-700 via-primary-600 to-secondary-500 p-10 text-white">
        <div>
          <span className="text-2xl font-bold tracking-tight">SkillIndiaConnect</span>
          <span className="ms-2 text-xs font-medium bg-white/20 px-2 py-0.5 rounded-full">
            For Employers
          </span>
        </div>

        <div className="space-y-6 max-w-sm">
          <h1 className="text-3xl font-bold leading-tight">{t('pageTitle')}</h1>
          <p className="text-white/80 text-base leading-relaxed">{t('pageSubtitle')}</p>

          <ul className="flex flex-col gap-3 mt-4">
            {trustBadges.map(({ icon, label }) => (
              <li key={label} className="flex items-center gap-2.5 text-sm text-white/90">
                <span className="size-7 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
                  {icon}
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <LanguageSwitcher />
      </div>

      {/* Form panel */}
      <div className="flex flex-1 flex-col">
        {/* Mobile header */}
        <div className="lg:hidden flex items-center justify-between px-6 pt-6 pb-4 bg-primary-600 text-white">
          <div>
            <span className="font-bold text-lg">SkillIndiaConnect</span>
            <span className="ms-2 text-xs bg-white/20 px-2 py-0.5 rounded-full">Employers</span>
          </div>
          <LanguageSwitcher />
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-sm">
            <EmployerLoginForm />
          </div>
        </div>
      </div>
    </div>
  );
}
