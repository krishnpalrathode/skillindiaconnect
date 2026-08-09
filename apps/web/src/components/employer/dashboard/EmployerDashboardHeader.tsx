'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Building2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { components } from '@skillindiaconnect/shared-types';

type Company = components['schemas']['Company'];

interface EmployerDashboardHeaderProps {
  company: Company;
  /**
   * Signed logo URL, or null while it is still loading / unavailable. It comes
   * from the employer PROFILE payload, not the dashboard one, so the header
   * must render perfectly well without it — hence the initials fallback rather
   * than a skeleton that would pop.
   */
  logoUrl?: string | null;
}

/** "Gulf Star Contracting LLC" → "GS". Same rule as the top bar's badge. */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * The dashboard's identity block.
 *
 * It replaces a greeting built from the email local-part — which rendered as
 * "Good morning, hr" — with the same thing the profile page leads with: the
 * company, its logo, and whether it is verified. Employers share this screen
 * and log in from shared inboxes; the company is the identity that means
 * something, the mailbox name is not.
 *
 * Visually a compact version of EmployerProfileHero: same gradient banner, same
 * overlapping logo tile, same name + Verified badge + industry/location lines.
 * It is a separate component rather than a reuse of that hero because the hero
 * owns logo UPLOAD (presign → PUT → confirm, keyboard-operable drop target),
 * and a dashboard header that silently opens a file picker would be a trap.
 */
export function EmployerDashboardHeader({ company, logoUrl }: EmployerDashboardHeaderProps) {
  const t = useTranslations('employer.profile.hero');
  const isApproved = company.status === 'APPROVED';
  const initials = initialsOf(company.name);

  // Country is the coarser of the two and only adds signal when it is not
  // already implied by the city line.
  const details = [company.industryType, company.location, company.country].filter(
    (value, index, all): value is string => !!value && all.indexOf(value) === index,
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200/70 bg-white shadow-sm">
      <div
        className="h-16 bg-gradient-to-br from-[#0F3D91] via-[#2E67B1] to-[#0F3D91]"
        aria-hidden="true"
      />

      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end sm:gap-4 sm:p-6">
        {/* Logo tile — overlaps the banner exactly like the profile hero. */}
        <div className="-mt-12 shrink-0 sm:-mt-14">
          <div className="flex size-16 items-center justify-center overflow-hidden rounded-2xl border-2 border-white bg-white shadow-md sm:size-20">
            {logoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={logoUrl}
                alt={t('logoAlt')}
                className="size-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : initials ? (
              <span
                aria-hidden="true"
                className="flex size-full items-center justify-center bg-gradient-to-br from-[#0F3D91] to-[#2E67B1] text-lg font-bold text-white sm:text-xl"
              >
                {initials}
              </span>
            ) : (
              <Building2 className="size-7 text-neutral-300" aria-hidden="true" />
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-neutral-900 break-words sm:text-2xl">
              {company.name}
            </h1>
            {isApproved && (
              <Badge variant="success" aria-label={t('approvedBadge')}>
                {t('verifiedBadge')}
              </Badge>
            )}
          </div>

          {isApproved && <p className="mt-0.5 text-xs text-success-fg">{t('approvedBadge')}</p>}

          {details.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-neutral-600">
              {details.map((detail) => (
                <span key={detail}>{detail}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
