'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import {
  MapPin,
  Calendar,
  Download,
  Share2,
  CheckCircle2,
  Camera,
  AlertTriangle,
} from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CompletionRing } from '@/components/common/CompletionRing';

type CandidateProfile = components['schemas']['CandidateProfile'];
type CompletionResult = components['schemas']['CompletionResult'];

interface ProfileHeroProps {
  profile: CandidateProfile;
  completion: CompletionResult;
}

function Initials({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <div
      className={`flex select-none items-center justify-center rounded-full bg-gradient-to-br from-[#0F3D91] to-[#2E67B1] font-bold text-white ${className ?? ''}`}
      aria-hidden="true"
    >
      {initials || '?'}
    </div>
  );
}

export function ProfileHero({ profile, completion }: ProfileHeroProps) {
  const t = useTranslations('profile.hero');

  const joinedDate = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long' })
    : null;

  return (
    <div className="overflow-hidden rounded-[18px] border border-neutral-200/70 bg-white shadow-[0_8px_30px_rgb(15,61,145,0.06)] transition-shadow duration-200 hover:shadow-[0_12px_36px_rgb(15,61,145,0.10)]">
      {/* Gradient banner */}
      <div
        className="h-28 bg-gradient-to-br from-[#0F3D91] via-[#2E67B1] to-[#0F3D91]"
        aria-hidden="true"
      />

      <div className="px-5 pb-6 sm:px-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-8">
          {/* ── Left column: identity + meta ── */}
          <div className="min-w-0 flex-1">
            {/* Avatar row — the avatar overlaps the banner; on desktop only the
                avatar is pulled up so the name stays clear of the banner. */}
            <div className="-mt-12 flex flex-col gap-4 sm:mt-0 sm:flex-row sm:items-end">
              {/* Avatar */}
              <div className="relative shrink-0 sm:-mt-14">
                <div className="rounded-full bg-white p-1 shadow-md">
                  <Initials name={profile.fullName || '?'} className="size-24 text-3xl" />
                </div>
                {/* Change photo — no API in S1; shown as disabled */}
                <button
                  type="button"
                  disabled
                  title={t('photoComingSoon')}
                  aria-label={t('changePhoto')}
                  // eslint-disable-next-line no-restricted-syntax -- DISABLED control — WCAG 1.4.3 explicitly exempts disabled UI, and darkening it would stop it reading as unavailable.
                  className="absolute -bottom-0.5 -end-0.5 flex size-8 cursor-not-allowed items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-400 shadow-sm"
                >
                  <Camera className="size-3.5" aria-hidden="true" />
                </button>
              </div>

              {/* Name + availability */}
              <div className="min-w-0 flex-1 pb-1">
                <h1 className="truncate text-2xl font-bold tracking-tight text-neutral-900">
                  {profile.fullName || '—'}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {profile.isAvailable ? (
                    <Badge variant="success" className="gap-1 px-2.5 py-1 text-xs">
                      <CheckCircle2 className="size-3" aria-hidden="true" />
                      {t('availableForWork')}
                    </Badge>
                  ) : (
                    <Badge variant="neutral" className="px-2.5 py-1 text-xs">
                      {t('notAvailable')}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Meta rows */}
            <div className="mt-5 flex min-w-0 flex-col gap-2 text-sm text-neutral-600">
              {profile.currentLocation && (
                <span className="flex items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#E8F0FE] text-[#0F3D91]">
                    <MapPin className="size-3.5" aria-hidden="true" />
                  </span>
                  <span className="truncate">{profile.currentLocation}</span>
                </span>
              )}
              {joinedDate && (
                <span className="flex items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#E8F0FE] text-[#0F3D91]">
                    <Calendar className="size-3.5" aria-hidden="true" />
                  </span>
                  <span>{t('memberSince', { date: joinedDate })}</span>
                </span>
              )}
            </div>
          </div>

          {/* ── Right column: completion panel (below the banner, not over it) ── */}
          <div className="flex shrink-0 items-center justify-center rounded-2xl border border-neutral-200/60 bg-gradient-to-br from-neutral-50 to-[#E8F0FE]/50 px-6 py-5 md:mt-5 md:w-60">
            <CompletionRing
              pct={completion.pct}
              size={150}
              strokeWidth={13}
              gradient
              gradientColors={['#0F3D91', '#F57C20']}
              glow
              milestones
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-5 flex flex-wrap gap-2">
          {/* Download resume — S7 feature */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            title={t('comingSoon')}
            aria-label={`${t('downloadResume')} — ${t('comingSoon')}`}
            className="min-h-10 gap-1.5 rounded-xl px-4"
          >
            <Download className="size-3.5" aria-hidden="true" />
            {t('downloadResume')}
          </Button>

          {/* Share profile — Phase 2 feature */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            title={t('comingSoon')}
            aria-label={`${t('shareProfile')} — ${t('comingSoon')}`}
            className="min-h-10 gap-1.5 rounded-xl px-4"
          >
            <Share2 className="size-3.5" aria-hidden="true" />
            {t('shareProfile')}
          </Button>
        </div>

        {/* What's missing hint */}
        {completion.missingForApply && completion.missingForApply.length > 0 && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning-bg p-4 text-xs text-warning-fg">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/70">
              <AlertTriangle className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="mb-1 font-semibold">To apply for jobs:</p>
              <ul className="list-inside list-disc space-y-0.5">
                {completion.missingForApply.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
