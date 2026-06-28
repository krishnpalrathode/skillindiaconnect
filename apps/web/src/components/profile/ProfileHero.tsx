'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { MapPin, Calendar, Download, Share2, CheckCircle2 } from 'lucide-react';
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
      className={`flex items-center justify-center rounded-full bg-primary-100 text-primary-700 font-bold select-none ${className ?? ''}`}
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
    <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
      {/* Gradient banner */}
      <div className="h-24 bg-gradient-to-e from-primary-600 to-secondary-600" aria-hidden="true" />

      <div className="px-5 pb-5">
        {/* Avatar row — overlaps the banner */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-10">
          {/* Avatar */}
          <div className="relative shrink-0">
            <Initials
              name={profile.fullName || '?'}
              className="size-20 text-2xl ring-4 ring-white"
            />
            {/* Change photo — no API in S1; shown as disabled */}
            <button
              type="button"
              disabled
              title={t('photoComingSoon')}
              aria-label={t('changePhoto')}
              className="absolute -end-1 -bottom-1 flex items-center justify-center size-7 rounded-full bg-white border border-neutral-200 shadow-sm text-neutral-400 cursor-not-allowed"
            >
              <span className="text-xs" aria-hidden="true">
                📷
              </span>
            </button>
          </div>

          {/* Name + availability */}
          <div className="flex-1 min-w-0 pb-1">
            <h1 className="text-xl font-bold text-neutral-900 truncate">
              {profile.fullName || '—'}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {profile.isAvailable ? (
                <Badge variant="success" className="gap-1 text-xs">
                  <CheckCircle2 className="size-3" aria-hidden="true" />
                  {t('availableForWork')}
                </Badge>
              ) : (
                <Badge variant="neutral" className="text-xs">
                  {t('notAvailable')}
                </Badge>
              )}
            </div>
          </div>

          {/* Completion ring (desktop: push to end of row) */}
          <div className="hidden sm:block shrink-0">
            <CompletionRing pct={completion.pct} size={88} strokeWidth={8} />
          </div>
        </div>

        {/* Mobile ring + meta row */}
        <div className="mt-4 flex items-start gap-4">
          <div className="sm:hidden shrink-0">
            <CompletionRing pct={completion.pct} size={80} strokeWidth={7} />
          </div>

          <div className="flex flex-col gap-1.5 text-sm text-neutral-500 min-w-0">
            {profile.currentLocation && (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{profile.currentLocation}</span>
              </span>
            )}
            {joinedDate && (
              <span className="flex items-center gap-1.5">
                <Calendar className="size-3.5 shrink-0" aria-hidden="true" />
                <span>{t('memberSince', { date: joinedDate })}</span>
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-4 flex flex-wrap gap-2">
          {/* Download resume — S7 feature */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            title={t('comingSoon')}
            aria-label={`${t('downloadResume')} — ${t('comingSoon')}`}
            className="gap-1.5"
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
            className="gap-1.5"
          >
            <Share2 className="size-3.5" aria-hidden="true" />
            {t('shareProfile')}
          </Button>
        </div>

        {/* What's missing hint */}
        {completion.missingForApply && completion.missingForApply.length > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-warning-bg border border-warning/30 text-xs text-warning-fg">
            <p className="font-medium mb-1">To apply for jobs:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {completion.missingForApply.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
