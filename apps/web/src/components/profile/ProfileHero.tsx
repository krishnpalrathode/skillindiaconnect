'use client';

import React, { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatMonthYear } from '@/lib/format/date';
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
import { Avatar } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/toast';
import { canExportResume, RESUME_MIN_COMPLETION_PCT } from '@/lib/resume/completionGate';
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

export function ProfileHero({ profile, completion }: ProfileHeroProps) {
  const t = useTranslations('profile.hero');
  const tToast = useTranslations('toast');
  const { showToast } = useToast();

  const [resumeBusy, setResumeBusy] = useState(false);
  // Separate from resumeBusy so sharing doesn't put the Download button into a
  // spinner (and vice versa) — they run the same pipeline but are two actions.
  const [shareBusy, setShareBusy] = useState(false);
  const [resumeError, setResumeError] = useState(false);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(profile.photoUrl ?? null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const joinedDate = profile.createdAt ? formatMonthYear(profile.createdAt) : null;

  /**
   * Download resume (S7). Reuse an already-READY render when one exists (instant,
   * no wasted Chromium slot); otherwise enqueue a generation and POLL to READY
   * before opening the freshly-signed PDF url — rendering is worker-side and
   * never synchronous. FAILED / timeout / network errors surface an inline retry.
   */
  /**
   * Make sure a rendered PDF exists, then mint a fresh short-lived signed url.
   * Shared by Download and Share so the generate→poll logic lives in one place.
   */
  async function ensureResumeUrl(): Promise<string> {
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

    const { url } = await getResumeDownloadUrl();
    return url;
  }

  /**
   * The 80%-complete gate for both export actions.
   *
   * Checked HERE rather than by disabling the buttons, deliberately: a disabled
   * button gives no reason, and on a profile that is 58% complete the reason is
   * the entire point — the candidate needs to know what to do next, not just
   * that they cannot do this. Returning true means "blocked, already explained".
   */
  function blockedByCompletion(): boolean {
    if (canExportResume(completion.pct)) return false;
    showToast({
      message: tToast('resumeNeedsCompletion', { pct: RESUME_MIN_COMPLETION_PCT }),
      variant: 'warning',
    });
    return true;
  }

  async function handleDownloadResume() {
    if (resumeBusy) return;
    if (blockedByCompletion()) return;
    setResumeBusy(true);
    setResumeError(false);
    try {
      const url = await ensureResumeUrl();
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setResumeError(true);
    } finally {
      setResumeBusy(false);
    }
  }

  /**
   * Share the candidate's resume PDF through the OS share sheet.
   *
   * There is deliberately NO public profile page to link to — `publicSlug` is a
   * dormant column with no endpoint, and exposing profile data at a guessable
   * URL would sit outside the viewer-aware privacy rules. The resume IS the
   * shareable form of the profile: the candidate already controls exactly which
   * fields it carries via Resume Settings, so sharing the FILE leaks nothing the
   * candidate has not opted into.
   *
   * Sharing the file rather than the signed url on purpose — that url is
   * short-lived, so a shared link would break for the recipient soon after.
   * Where file sharing is unavailable (most desktop browsers) it falls back to
   * opening the PDF so the user can attach it themselves.
   */
  async function handleShareProfile() {
    if (shareBusy) return;
    if (blockedByCompletion()) return;
    setShareBusy(true);
    setResumeError(false);
    try {
      const url = await ensureResumeUrl();
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], `${profile.fullName || 'resume'}.pdf`, {
        type: 'application/pdf',
      });

      const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: profile.fullName ?? undefined });
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      // Dismissing the OS share sheet rejects with AbortError — a deliberate
      // cancel is not a failure and must not surface an error message.
      if ((err as Error)?.name === 'AbortError') return;
      setResumeError(true);
    } finally {
      setShareBusy(false);
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
      showToast({ message: tToast('photoUpdated') });
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
                  <Avatar
                    name={profile.fullName || '?'}
                    photoUrl={photoUrl}
                    className="size-24 text-3xl"
                  />
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

          {/* Share profile — hands the resume PDF to the OS share sheet. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleShareProfile}
            disabled={shareBusy}
            aria-label={t('shareProfile')}
            aria-busy={shareBusy}
            className="min-h-10 gap-1.5 rounded-xl px-4"
          >
            {shareBusy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Share2 className="size-3.5" aria-hidden="true" />
            )}
            {shareBusy ? t('preparingResume') : t('shareProfile')}
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
