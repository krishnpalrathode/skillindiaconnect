'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError } from '@/lib/api/client';
import { generateResume, getResumeStatus, getResumeDownloadUrl } from '@/lib/api/resume';
import { GenerationStatus, type GenerationPhase } from './GenerationStatus';

type ResumeGeneration = components['schemas']['ResumeGeneration'];

type Phase = 'idle' | GenerationPhase;

interface DownloadResumeButtonProps {
  /** The latest generation from `GET /candidates/me/resume` — lets an already
   *  READY resume offer re-download without forcing a fresh generate. */
  initialGeneration?: ResumeGeneration | null;
  /** Fired when a generation reaches READY (the hub refreshes lastRenderedAt). */
  onGenerated?: (generatedAt: string) => void;
  /**
   * Poll backoff schedule (ms) and total budget. Injectable so tests drive the
   * timeout path fast; production widens 1.5s→6s until the budget is spent.
   */
  pollSchedule?: number[];
  timeoutMs?: number;
  /**
   * How a READY signed url is handed to the browser. Default opens it in a new
   * tab (the R2 GET url streams the PDF). Injectable so tests assert the
   * download fired ONLY after READY — never while PENDING.
   */
  download?: (url: string) => void;
  /**
   * Whether the ready-state Regenerate button renders HERE. The resume hub sets
   * this false and renders it below "Choose a template" instead, so the flow
   * reads pick-a-template → regenerate. Defaults true so any other mount keeps
   * its existing layout.
   */
  showRegenerate?: boolean;
  /**
   * Publishes the regenerate action (or null when not regenerable yet) so a host
   * can place the button elsewhere. Deliberately shares the SAME handler rather
   * than letting the host call generate itself — one generation code path, one
   * set of poll/backoff/duplicate-click guards.
   */
  onRegenerateChange?: (regenerate: (() => void) | null) => void;
}

const DEFAULT_SCHEDULE = [1500, 1500, 2000, 3000, 4000, 6000];
const DEFAULT_TIMEOUT_MS = 60_000;

function defaultDownload(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Download PDF — the ASYNC generation UX (S7-F1), the third appearance of the
 * pending→ready lesson. Generation renders worker-side (Chromium, seconds), so
 * this NEVER treats generate as instant:
 *
 *   click → POST /generate (PENDING) → POLL /status with backoff →
 *     READY   → auto-download the signed url + keep a re-download action
 *     FAILED  → an honest retry (re-generate)
 *     budget spent → an honest "taking longer than expected", never false-ready
 *
 * The button is disabled while a generation is in flight so repeated clicks
 * cannot spawn parallel generations (the API dedupes too — the UI cooperates).
 */
export function DownloadResumeButton({
  initialGeneration,
  onGenerated,
  pollSchedule = DEFAULT_SCHEDULE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  download = defaultDownload,
  showRegenerate = true,
  onRegenerateChange,
}: DownloadResumeButtonProps) {
  const t = useTranslations('resume');
  const tToast = useTranslations('toast');
  const { showToast } = useToast();

  /*
    The toast helpers go through a ref, and that is load-bearing rather than
    tidiness: next-intl hands back a BRAND NEW `t` on every render. Naming
    `tToast` directly in `settle`'s dependency list made `settle` unstable,
    which cascaded runPoll → startPolling → startGenerate, which re-ran the
    `onRegenerateChange` effect below on every render. The hub answers that by
    storing the callback in state, so the effect re-rendered the hub, which
    re-rendered this, which minted another `tToast`… an infinite render loop
    that pinned a core and hung the resume page (and the test that mounts it).
  */
  const toastRef = useRef({ showToast, tToast });
  toastRef.current = { showToast, tToast };

  const initialPhase: Phase =
    initialGeneration?.status === 'READY'
      ? 'ready'
      : initialGeneration?.status === 'PENDING'
        ? 'generating'
        : initialGeneration?.status === 'FAILED'
          ? 'failed'
          : 'idle';

  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [downloading, setDownloading] = useState(false);
  const downloadUrl = useRef<string | null>(initialGeneration?.downloadUrl ?? null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);
  const startedAt = useRef<number>(0);
  const attempt = useRef(0);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // READY reached via polling → capture the url, auto-download once, notify.
  const settle = useCallback(
    (gen: ResumeGeneration): boolean => {
      if (gen.status === 'READY') {
        downloadUrl.current = gen.downloadUrl ?? null;
        setPhase('ready');
        if (gen.downloadUrl) download(gen.downloadUrl);
        if (gen.generatedAt) onGenerated?.(gen.generatedAt);
        // Only on the POLLED transition — a resume that was already READY at
        // mount is not something the user just did, and announcing it on every
        // page load would be noise.
        toastRef.current.showToast({ message: toastRef.current.tToast('resumeReady') });
        return true;
      }
      if (gen.status === 'FAILED') {
        setPhase('failed');
        return true;
      }
      return false; // PENDING — keep waiting
    },
    [download, onGenerated],
  );

  const scheduleNext = useCallback(
    (runPoll: () => void) => {
      if (Date.now() - startedAt.current >= timeoutMs) {
        setPhase('timeout');
        return;
      }
      const delay = pollSchedule[Math.min(attempt.current, pollSchedule.length - 1)]!;
      attempt.current += 1;
      timer.current = setTimeout(runPoll, delay);
    },
    [pollSchedule, timeoutMs],
  );

  const runPoll = useCallback(async () => {
    if (cancelled.current) return;
    try {
      const gen = await getResumeStatus();
      if (cancelled.current) return;
      if (!settle(gen)) scheduleNext(runPoll);
    } catch {
      // A transient poll error is not a generation failure — keep polling
      // within the budget; the timeout state is the honest resolution.
      if (!cancelled.current) scheduleNext(runPoll);
    }
  }, [settle, scheduleNext]);

  const startPolling = useCallback(() => {
    cancelled.current = false;
    startedAt.current = Date.now();
    attempt.current = 0;
    setPhase('generating');
    runPoll();
  }, [runPoll]);

  // Trigger a fresh generation (from idle, or a retry/regenerate).
  const startGenerate = useCallback(async () => {
    clearTimer();
    setPhase('generating');
    try {
      await generateResume();
      startPolling();
    } catch {
      setPhase('failed');
    }
  }, [clearTimer, startPolling]);

  /*
    Publish the regenerate action while a resume is READY, and withdraw it
    otherwise, so a host rendering the button elsewhere shows it under exactly
    the same condition this component would. Cleared on unmount so a stale
    closure can never trigger a generation from a screen that is gone.

    The published function is created ONCE and calls through a ref. Publishing
    `() => startGenerate()` inline instead minted a new function on every run
    of the effect, and the host stores what it receives in state — so each
    publish re-rendered the host, which re-rendered this, which published
    again: an infinite loop no amount of equality-checking on the host side
    could break, because the value really was new each time. A stable identity
    is the only thing that terminates it, so the effect now depends on `phase`
    alone in practice.
  */
  const startGenerateRef = useRef(startGenerate);
  startGenerateRef.current = startGenerate;
  const publishedRegenerate = useCallback(() => void startGenerateRef.current(), []);

  useEffect(() => {
    onRegenerateChange?.(phase === 'ready' ? publishedRegenerate : null);
    return () => onRegenerateChange?.(null);
  }, [phase, publishedRegenerate, onRegenerateChange]);

  // Resume polling if we mounted onto an in-flight (PENDING) generation.
  useEffect(() => {
    if (initialPhase === 'generating') startPolling();
    return () => {
      cancelled.current = true;
      clearTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-download a READY resume: re-mint the (short-lived) signed url first, so
  // an expired link refreshes; a 404 means it's gone → regenerate.
  const reDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const { url } = await getResumeDownloadUrl();
      downloadUrl.current = url;
      download(url);
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.status === 404) {
        await startGenerate();
      }
      // other errors: leave the ready state; the user can try again
    } finally {
      setDownloading(false);
    }
  }, [download, startGenerate]);

  if (phase === 'idle') {
    return (
      <Button
        type="button"
        variant="primary"
        size="lg"
        onClick={startGenerate}
        className="w-full rounded-xl bg-gradient-to-r from-[#0F3D91] to-[#2E67B1] shadow-md transition-all hover:shadow-lg sm:w-auto sm:self-center sm:px-10"
      >
        <Download className="size-4" aria-hidden="true" />
        {t('downloadPdf')}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <GenerationStatus
        phase={phase}
        onDownload={reDownload}
        downloading={downloading}
        onRetry={startGenerate}
      />
      {phase === 'ready' && showRegenerate && (
        <Button type="button" variant="outline" size="md" onClick={startGenerate}>
          {t('regenerate')}
        </Button>
      )}
    </div>
  );
}
