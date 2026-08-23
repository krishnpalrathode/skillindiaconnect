'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PartyPopper } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { DialogShell } from '@/components/ui/dialog-shell';

type CompletionResult = components['schemas']['CompletionResult'];

/**
 * "You can now apply for jobs" — shown once, the moment a candidate's profile
 * becomes good enough to apply with.
 *
 * ── Why this watches `canApply`, not "pct >= 70" ────────────────────────────
 * 70 is today's value of the `candidates.min_completion_pct` setting, which an
 * admin can change from the console — a hardcoded 70 would start lying the day
 * someone moves it. Worse, the percentage is only ONE of three conditions:
 * applying also requires every mandatory document and an unexpired passport.
 * A candidate can sit at 78% with a missing document and still be blocked, so
 * a popup keyed on the number alone would congratulate them on an ability they
 * do not have, and they would find out when their application was refused.
 *
 * `canApply` is the server's own answer to the exact question this popup
 * claims to answer, and it is the same flag the Apply button gates on. Today it
 * flips at 70%, which is what was asked for — it just stays correct on its own.
 *
 * ── Why a TRANSITION, and not simply `canApply === true` ────────────────────
 * Rendering on the flag alone would greet every already-eligible candidate with
 * a celebration every time they opened their profile — announcing news that is
 * months old. So the first observed value only ARMS the dialog: it fires on a
 * false → true change, which is the moment something actually changed for them.
 *
 * A candidate who was already eligible is marked as seen without being shown
 * anything, so this stays quiet for them on this device from then on.
 */

/** One key per candidate — a shared browser must not silence someone else's. */
function seenKey(userId: string): string {
  return `sic:apply-unlocked-seen:${userId}`;
}

function hasSeen(userId: string): boolean {
  try {
    return window.localStorage.getItem(seenKey(userId)) === '1';
  } catch {
    // Private mode, or storage disabled. Treat as "already seen" rather than
    // risking a popup that reappears on every single page load with no way to
    // make it stop.
    return true;
  }
}

function markSeen(userId: string): void {
  try {
    window.localStorage.setItem(seenKey(userId), '1');
  } catch {
    // Nothing to do — see hasSeen().
  }
}

interface ApplyUnlockedDialogProps {
  /** Null while the first fetch is in flight. */
  completion: CompletionResult | null;
  /**
   * Scopes the once-only flag. Passed IN rather than read from useAuth here so
   * this component stays a pure function of its props — the page that renders it
   * already holds the user, and taking the dependency here would mean any test
   * of the fire-once rule had to stand up an authenticated session first.
   *
   * Null while auth is resolving; the dialog simply waits.
   */
  userId: string | null;
}

export function ApplyUnlockedDialog({ completion, userId }: ApplyUnlockedDialogProps) {
  const t = useTranslations('profile.applyUnlocked');
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState(0);

  /**
   * `false` until we have seen a value. Held in a ref, not state, because
   * changing it must not re-render — it only decides what the NEXT completion
   * value means.
   */
  const armed = useRef(false);

  const canApply = completion?.canApply ?? null;

  useEffect(() => {
    if (!userId || canApply === null) return;

    if (hasSeen(userId)) return;

    if (!canApply) {
      // Not eligible yet — the next flip to true is the real moment.
      armed.current = true;
      return;
    }

    if (!armed.current) {
      /*
        Eligible on the very first value we saw, so nothing changed while they
        were here — they arrived already able to apply. Record it silently so
        this never fires for them later, and say nothing now.
      */
      markSeen(userId);
      return;
    }

    setPct(completion?.pct ?? 0);
    setOpen(true);
    markSeen(userId);
  }, [userId, canApply, completion]);

  if (!open) return null;

  const dismiss = () => setOpen(false);

  return (
    <DialogShell
      titleId="apply-unlocked-title"
      title={t('title')}
      busy={false}
      confirmLabel={t('browseJobs')}
      confirmVariant="primary"
      onConfirm={() => {
        setOpen(false);
        router.push(`/${locale}/jobs`);
      }}
      onClose={dismiss}
      cancelLabel={t('later')}
    >
      <div className="mt-3 flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#E8F0FE] text-[#0F3D91]"
          aria-hidden="true"
        >
          <PartyPopper className="size-5" />
        </span>
        <p className="text-sm text-neutral-700">{t('body', { pct })}</p>
      </div>
    </DialogShell>
  );
}
