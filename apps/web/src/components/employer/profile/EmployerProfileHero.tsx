'use client';

import React, { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useLogoUpload } from '@/lib/employer/useLogoUpload';
import { ChecklistNudge } from './ChecklistNudge';
import type { components } from '@skillindiaconnect/shared-types';

type EmployerProfile = components['schemas']['EmployerProfile'];

interface EmployerProfileHeroProps {
  profile: EmployerProfile;
  onProfileUpdate: (updated: EmployerProfile) => void;
}

/**
 * Profile hero: company logo (with upload), name, industry, location,
 * Verified / Approved badge (APPROVED companies only), and ChecklistNudge.
 *
 * Logo upload: JPEG/PNG only, 2 MB max. Full presign→PUT→confirm chain via
 * useLogoUpload; confirm returns the updated EmployerProfile.
 * The upload div is keyboard-operable (tabIndex=0, Enter/Space triggers file picker).
 */
export function EmployerProfileHero({ profile, onProfileUpdate }: EmployerProfileHeroProps) {
  const t = useTranslations('employer.profile.hero');
  const inputRef = useRef<HTMLInputElement>(null);
  const { state: upload, run, retry, reset } = useLogoUpload(onProfileUpdate);

  const { company, logoUrl, profileChecklist } = profile;
  const isApproved = company.status === 'APPROVED';
  const isActive =
    upload.status === 'presigning' ||
    upload.status === 'uploading' ||
    upload.status === 'confirming';

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (inputRef.current) inputRef.current.value = '';
    await run(file);
  };

  const handleLogoInteract = () => {
    if (isActive) return;
    if (upload.status === 'error') {
      retry();
    } else {
      reset();
      inputRef.current?.click();
    }
  };

  const logoLabel =
    upload.status === 'error'
      ? t('uploadError')
      : logoUrl
        ? t('changeLogoLabel')
        : t('uploadLogoLabel');

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200/70 bg-white shadow-sm">
      {/* Gradient banner */}
      <div
        className="h-24 bg-gradient-to-br from-[#0F3D91] via-[#2E67B1] to-[#0F3D91]"
        aria-hidden="true"
      />
      <div className="p-5 sm:p-6">
        {/* Logo overlaps the banner (avatar style) */}
        <div className="-mt-16">
          {/* Logo zone */}
          <div
            role="button"
            tabIndex={isActive ? -1 : 0}
            aria-label={logoLabel}
            aria-disabled={isActive}
            aria-busy={isActive}
            onClick={handleLogoInteract}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleLogoInteract();
              }
            }}
            className={cn(
              'relative flex items-center justify-center shrink-0',
              'size-24 rounded-2xl border-2 border-dashed overflow-hidden bg-white shadow-md',
              'transition-all cursor-pointer',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
              isActive
                ? 'border-neutral-300 bg-neutral-50 cursor-wait'
                : upload.status === 'error'
                  ? 'border-error/50 bg-error-bg/30 hover:bg-error-bg/50'
                  : logoUrl
                    ? 'border-white bg-neutral-50 hover:border-[#0F3D91]/40'
                    : 'border-neutral-300 bg-neutral-50 hover:border-[#0F3D91]/40 hover:bg-[#E8F0FE]',
            )}
          >
            {isActive ? (
              <Spinner size={24} label={t('uploading')} />
            ) : logoUrl && upload.status !== 'error' ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={logoUrl}
                alt={t('logoAlt')}
                className="size-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <Building2 className="size-8 text-neutral-300" aria-hidden="true" />
            )}

            {/* Hover overlay for existing logo */}
            {logoUrl && !isActive && upload.status !== 'error' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity">
                <RefreshCw className="size-5 text-white" aria-hidden="true" />
              </div>
            )}
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="sr-only"
          aria-label={logoLabel}
          onChange={handleFileChange}
        />

        {/* Company info — on the white card so every line stays legible */}
        <div className="mt-4 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900 break-words">
              {company.name}
            </h1>
            {isApproved && (
              <Badge variant="success" aria-label={t('approvedBadge')}>
                {t('verifiedBadge')}
              </Badge>
            )}
          </div>

          {isApproved && <p className="text-xs text-success-fg mt-0.5">{t('approvedBadge')}</p>}

          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-sm text-neutral-600">
            {company.industryType && <span>{company.industryType}</span>}
            {company.location && <span>{company.location}</span>}
          </div>

          {upload.status === 'error' && (
            <p className="text-xs text-error-fg mt-1" role="alert">
              {upload.errorMessage ?? t('uploadError')}
            </p>
          )}
          {upload.status === 'done' && (
            <p className="text-xs text-success-fg mt-1">{t('uploadDone')}</p>
          )}

          <p className="text-xs text-neutral-600 mt-1">{t('typeHint')}</p>
        </div>

        {/* Checklist nudge — below the hero row */}
        {profileChecklist.hint && <ChecklistNudge hint={profileChecklist.hint} className="mt-5" />}
      </div>
    </div>
  );
}
