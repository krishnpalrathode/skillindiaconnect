'use client';

import React, { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  MapPin,
  Calendar,
  Download,
  Share2,
  CheckCircle2,
  Camera,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CompletionRing } from '@/components/common/CompletionRing';
import { getResume, generateResume, getResumeStatus, getResumeDownloadUrl } from '@/lib/api/resume';
import { presignPhoto, confirmPhoto, uploadToPresignedUrl } from '@/lib/api/candidate';

const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

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

  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeError, setResumeError] = useState(false);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(profile.photoUrl ?? null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const joinedDate = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long' })
    : null;

  /**
   * Download resume (S7). Reuse an already-READY render when one exists (instant,
   * no wasted Chromium slot); otherwise enqueue a generation and POLL to READY
   * before opening the freshly-signed PDF url — rendering is worker-side and
   * never synchronous. FAILED / timeout / network errors surface an inline retry.
   */
  async function handleDownloadResume() {
    if (resumeBusy) return;
    setResumeBusy(true);
    setResumeError(false);
    try {
      const info = await getResume();
      let ready = info.current?.status === 'READY';

      if (!ready) {
        await generateResume();
        // ~40s ceiling: a 30s render × retries settles well inside this.
        for (let i = 0; i < 20 && !ready; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const status = await getResumeStatus();
          if (status.status === 'READY') ready = true;
          else if (status.status === 'FAILED') throw new Error('render failed');
        }
        if (!ready) throw new Error('render timed out');
      }

      // Re-mint a fresh short-lived signed url and hand it to the browser.
      const { url } = await getResumeDownloadUrl();
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setResumeError(true);
    } finally {
      setResumeBusy(false);
    }
  }

  /**
   * Change photo: presign → PUT the bytes straight to R2 → confirm (which
   * persists the key and returns the signed url). Client-side validates
   * type/size first for instant feedback; the server re-validates from the
   * stored object, so this is UX, not the security boundary.
   */
  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file after an error
    if (!file || photoBusy) return;

    setPhotoError(null);
    if (!PHOTO_MIME_TYPES.includes(file.type)) {
      setPhotoError(t('photoTypeError'));
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setPhotoError(t('photoSizeError'));
      return;
    }

    setPhotoBusy(true);
    try {
      const presign = await presignPhoto({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      await uploadToPresignedUrl(presign.uploadUrl, file);
      const updated = await confirmPhoto(presign.key);
      setPhotoUrl(updated.photoUrl ?? null);
    } catch {
      setPhotoError(t('photoUploadError'));
    } finally {
      setPhotoBusy(false);
    }
  }

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
                <div className="overflow-hidden rounded-full bg-white p-1 shadow-md">
                  {photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed R2 url, not a static asset; next/image can't optimize a short-lived presigned url.
                    <img
                      src={photoUrl}
                      alt={profile.fullName || ''}
                      className="size-24 rounded-full object-cover"
                    />
                  ) : (
                    <Initials name={profile.fullName || '?'} className="size-24 text-3xl" />
                  )}
                </div>
                {/* Change photo — presign → PUT → confirm. */}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={handlePhotoChange}
                  tabIndex={-1}
                  aria-hidden="true"
                />
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoBusy}
                  aria-label={t('changePhoto')}
                  aria-busy={photoBusy}
                  className="absolute -bottom-0.5 -end-0.5 flex size-8 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-sm transition-colors hover:text-[#0F3D91] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 disabled:cursor-wait"
                >
                  {photoBusy ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Camera className="size-3.5" aria-hidden="true" />
                  )}
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

            {photoError && (
              <p role="alert" className="mt-3 text-xs font-medium text-error-fg">
                {photoError}
              </p>
            )}

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
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {/* Download resume — wired to the S7 resume flow (generate → poll → download). */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDownloadResume}
            disabled={resumeBusy}
            aria-label={t('downloadResume')}
            aria-busy={resumeBusy}
            className="min-h-10 gap-1.5 rounded-xl px-4"
          >
            {resumeBusy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="size-3.5" aria-hidden="true" />
            )}
            {resumeBusy ? t('preparingResume') : t('downloadResume')}
          </Button>

          {/* Share profile — Phase 2 feature (public slug/page not built; no public endpoint) */}
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

        {resumeError && (
          <p role="alert" className="mt-2 text-xs font-medium text-error-fg">
            {t('resumeError')}
          </p>
        )}

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
