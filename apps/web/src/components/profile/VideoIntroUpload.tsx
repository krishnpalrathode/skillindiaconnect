'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Video, Trash2, Play, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import {
  getCandidateVideo,
  presignVideo,
  confirmVideo,
  deleteCandidateVideo,
  getCandidateVideoUrl,
  uploadToPresignedUrl,
  type CandidateVideoStatus,
} from '@/lib/api/candidate';

/** Container formats the API accepts — mirrored from VIDEO_MIME_TYPES server-side. */
const ACCEPT = 'video/mp4,video/quicktime,video/webm';

/**
 * Read a local file's duration WITHOUT uploading it.
 *
 * This is the only place the length can be measured on the client, and doing it
 * here is the point: a two-minute rule enforced after the upload would mean the
 * candidate spends their mobile data and then gets refused. The object URL is
 * revoked in every path — a leaked blob URL pins the whole file in memory, and
 * these files are megabytes.
 *
 * Rejects rather than guessing when the browser cannot decode the file: a
 * duration of `Infinity` or `NaN` means the container is one we cannot verify,
 * and sending an unverified length would defeat the check.
 */
function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement('video');
    el.preload = 'metadata';

    const done = (fn: () => void) => {
      URL.revokeObjectURL(url);
      el.removeAttribute('src');
      fn();
    };

    el.onloadedmetadata = () => {
      const d = el.duration;
      if (!Number.isFinite(d) || d <= 0) {
        done(() => reject(new Error('UNREADABLE')));
        return;
      }
      done(() => resolve(d));
    };
    el.onerror = () => done(() => reject(new Error('UNREADABLE')));
    el.src = url;
  });
}

function formatDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface VideoIntroUploadProps {
  /** Called after any change so the parent can refresh dependent UI. */
  onChanged?: (status: CandidateVideoStatus) => void;
}

/**
 * The candidate's working-video introduction — record on a phone, upload here.
 *
 * REPLACES the "coming soon" placeholder that sat in the documents section.
 *
 * It is deliberately not a `FileUpload`: that component is built around the
 * document flow (a doc type, an expiry date, a verification status) and every
 * one of those is meaningless here. What this needs instead — reading the
 * duration before uploading, playing the result back from a signed url,
 * replacing rather than accumulating — is most of the component.
 *
 * Both limits are read from the SERVER (`GET /candidates/me/video` echoes them)
 * rather than hardcoded, so when a Super-Admin changes the Setting the hint text
 * and the client-side pre-check move with it instead of lying.
 */
export function VideoIntroUpload({ onChanged }: VideoIntroUploadProps) {
  const t = useTranslations('profile.video');
  const tToast = useTranslations('toast');
  const { showToast } = useToast();

  const [status, setStatus] = useState<CandidateVideoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const maxMb = status?.maxMb ?? 10;
  const maxDurationSec = status?.maxDurationSec ?? 120;

  useEffect(() => {
    let active = true;
    getCandidateVideo()
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => {
        // A status fetch failure must not break the profile page — the section
        // simply shows its empty state and the upload still works.
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleFile(file: File) {
    setBusy(true);
    setProgressLabel(t('checking'));
    try {
      // 1. Size — checked here so an oversized file never leaves the phone.
      if (file.size > maxMb * 1024 * 1024) {
        showToast({ message: t('errTooLarge', { maxMb }), variant: 'error' });
        return;
      }

      // 2. Duration — same reason, and the only place it can be measured.
      let durationSec: number;
      try {
        durationSec = await readVideoDuration(file);
      } catch {
        showToast({ message: t('errUnreadable'), variant: 'error' });
        return;
      }
      if (durationSec > maxDurationSec) {
        showToast({
          message: t('errTooLong', { max: formatDuration(maxDurationSec) }),
          variant: 'error',
        });
        return;
      }

      // 3. presign → PUT to R2 → confirm.
      setProgressLabel(t('uploading'));
      const { uploadUrl, key } = await presignVideo({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        durationSec,
      });
      await uploadToPresignedUrl(uploadUrl, file);

      setProgressLabel(t('saving'));
      const next = await confirmVideo(key, durationSec);
      setStatus(next);
      onChanged?.(next);
      // A replaced video invalidates the url we were holding.
      setPlaybackUrl(null);
      showToast({ message: t('uploaded'), variant: 'success' });
    } catch {
      showToast({ message: tToast('saveFailed'), variant: 'error' });
    } finally {
      setBusy(false);
      setProgressLabel(null);
      // Clear the input so picking the SAME file again still fires onChange.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    try {
      const next = await deleteCandidateVideo();
      setStatus(next);
      onChanged?.(next);
      setPlaybackUrl(null);
      showToast({ message: t('removed'), variant: 'success' });
    } catch {
      showToast({ message: tToast('saveFailed'), variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handlePlay() {
    if (playbackUrl) return;
    try {
      const { url } = await getCandidateVideoUrl();
      setPlaybackUrl(url);
    } catch {
      showToast({ message: tToast('saveFailed'), variant: 'error' });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-neutral-200 p-4">
        <Spinner size={16} label={t('loading')} />
      </div>
    );
  }

  const hasVideo = !!status?.hasVideo;

  return (
    /* `id` is the anchor the dashboard prompt links to (#video-intro). */
    <div
      id="video-intro"
      className="scroll-mt-24 rounded-2xl border border-neutral-200 bg-white p-4"
    >
      <div className="flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-600"
          aria-hidden="true"
        >
          <Video className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-neutral-900">{t('title')}</p>
          <p className="mt-0.5 text-xs leading-snug text-neutral-600">
            {t('hint', { maxMb, max: formatDuration(maxDurationSec) })}
          </p>
        </div>
      </div>

      {hasVideo ? (
        <div className="mt-4 flex flex-col gap-3">
          {playbackUrl ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- a candidate's
            // own self-recorded clip; there is no caption track to offer and the
            // only viewer here is the person who filmed it.
            <video
              src={playbackUrl}
              controls
              autoPlay
              className="w-full rounded-xl border border-neutral-200 bg-black"
            />
          ) : (
            <button
              type="button"
              onClick={() => void handlePlay()}
              className="flex items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 py-8 text-sm font-semibold text-primary-700 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              <Play className="size-4" aria-hidden="true" />
              {t('play')}
            </button>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-neutral-600">
              {t('meta', {
                duration: formatDuration(status?.durationSec ?? 0),
                mb: ((status?.sizeBytes ?? 0) / (1024 * 1024)).toFixed(1),
              })}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                {busy && <Spinner size={14} label="" />}
                {progressLabel ?? t('replace')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void handleDelete()}
                className="text-error-fg hover:bg-error-bg"
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {t('remove')}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="mt-4 w-full sm:w-auto"
        >
          {busy ? <Spinner size={14} label="" /> : <Upload className="size-4" aria-hidden="true" />}
          {progressLabel ?? t('upload')}
        </Button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}
