'use client';

import React from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ShieldCheck, BadgeCheck, Globe } from 'lucide-react';
import { LanguageSwitcher } from '@/components/auth/LanguageSwitcher';
import { EmployerLoginForm } from '@/components/employer/EmployerLoginForm';

/**
 * Employer login (split layout; hero stacks above the form on mobile).
 *
 * The hero uses the single combined artwork /brand/employer-login-hero.png —
 * the official branding, blue overlay, and bottom wave are baked in, so this
 * page renders NO separate logo and NO extra decoration. The artwork renders
 * at its NATURAL ratio, full width and never cropped (object-cover on a narrow
 * panel would amputate either the baked-in logo or the employer). Its bottom
 * edge self-fades to #001740 (sampled from the file) — the panel uses exactly
 * that navy so the image dissolves into the text band with no visible seam.
 *
 * Hero copy is hardcoded EN to match the approved composition (same precedent
 * as the candidate auth heroes; translation files are frozen in this pass).
 * Feature titles keep their existing i18n keys.
 */

export default function EmployerLoginPage() {
  const t = useTranslations('employer.login');

  const features = [
    {
      Icon: BadgeCheck,
      title: t('trustBadge1'),
      description: 'Access pre-verified and skilled workers',
    },
    {
      Icon: ShieldCheck,
      title: t('trustBadge2'),
      description: 'Safe, transparent and reliable',
    },
    {
      Icon: Globe,
      title: t('trustBadge3'),
      description: 'Hire talents across India and the Gulf.',
    },
  ];

  return (
    <div className="min-h-svh flex flex-col lg:flex-row bg-white">
      {/* Hero — left on desktop, stacked above the form on mobile */}
      <div className="relative grid overflow-hidden bg-[#001740] text-white lg:min-h-svh lg:w-1/2">
        {/* Complete artwork — branding, overlay, and wave are baked in; its
            bottom edge self-fades into the panel navy */}
        <Image
          src="/brand/employer-login-hero.png"
          alt="SkillIndia Connect — Elevating Skills, Connecting Futures"
          width={1448}
          height={1086}
          priority
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="col-start-1 row-start-1 h-auto w-full self-start"
        />

        {/* Overlay content — headline, subtitle, and features ONLY (no extra
            branding). Bottom-anchored over the artwork's dark zone; pt keeps
            the column clear of the baked-in logo when space is tight. */}
        <div className="relative z-10 col-start-1 row-start-1 flex flex-col justify-end gap-7 p-6 pt-44 sm:p-10 sm:pt-52">
          <div className="max-w-xl">
            <p className="text-3xl font-bold leading-tight sm:text-4xl lg:text-[2.75rem] lg:leading-[1.15] [text-shadow:0_2px_14px_rgba(0,16,44,0.7)]">
              Hire Verified
              <br />
              Blue-Collar
              <br />
              <span className="text-[#F57C20]">Workers</span>
            </p>

            <div className="mt-5 h-1 w-14 rounded-full bg-[#F57C20]" aria-hidden="true" />

            <p className="mt-5 max-w-md text-base text-white/90 sm:text-lg [text-shadow:0_1px_8px_rgba(0,16,44,0.7)]">
              Connect with skilled, verified workers across{' '}
              <span className="font-semibold text-[#F57C20]">India</span> and the{' '}
              <span className="font-semibold text-[#F57C20]">Gulf</span>.
            </p>
          </div>

          {/* Feature list */}
          <ul className="flex flex-col gap-4 pb-1">
            {features.map(({ Icon, title, description }) => (
              <li key={title} className="flex items-center gap-3.5">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/25">
                  <Icon className="size-5 text-white" aria-hidden="true" />
                </span>
                <span className="leading-tight">
                  <span className="block text-sm font-bold sm:text-base">{title}</span>
                  <span className="block text-xs text-white/75 sm:text-sm">{description}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 flex-col bg-[#f4f6fa] lg:w-1/2">
        <div className="flex justify-end px-4 pt-4 sm:px-8 sm:pt-6">
          <LanguageSwitcher variant="light" />
        </div>
        <div className="flex flex-1 items-start justify-center px-4 pb-12 pt-4 sm:px-8 lg:items-center lg:pt-0">
          <div className="w-full max-w-[560px] rounded-2xl border border-neutral-200/70 bg-white px-5 py-8 shadow-[0_12px_40px_-12px_rgba(15,61,145,0.16)] sm:px-9 sm:py-9">
            <EmployerLoginForm />
          </div>
        </div>
      </div>
    </div>
  );
}
