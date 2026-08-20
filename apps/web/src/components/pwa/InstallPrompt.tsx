'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, X } from 'lucide-react';

/**
 * The `beforeinstallprompt` event, which TypeScript's DOM lib does not model.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Remembers a dismissal so the banner asks once, not once per page view. */
const DISMISSED_KEY = 'sic.pwa.install-dismissed';

/**
 * A dismissible "add to home screen" banner.
 *
 * Deliberately restrained: it sits at the bottom of the viewport, never overlays
 * or blocks content, and a dismissal is remembered permanently. The people using
 * this app are looking for work on a cheap phone — a nagging install banner
 * competing with the job they are reading is worse than no banner at all.
 *
 * It renders nothing at all unless the browser has actually offered an install,
 * so it cannot appear in the already-installed app: Chrome does not fire
 * `beforeinstallprompt` in an installed PWA or TWA.
 */
export function InstallPrompt() {
  const t = useTranslations('pwa.install');
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // A previous dismissal ends it — do not even listen.
    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;
    } catch {
      // Private mode / storage disabled. Fall through and just show the banner;
      // it is dismissible either way, it simply will not be remembered.
    }

    const onPrompt = (event: Event) => {
      // Chrome shows its own mini-infobar unless the event is preventDefault'd.
      // We take over so the ask matches the app's language and styling.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = useCallback(() => {
    setDeferred(null);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* storage unavailable — the banner is gone for this session regardless */
    }
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    /*
      Cleared whichever way they answered. The event is single-use — Chrome will
      fire a fresh one later if they declined and remain eligible — and a
      declined install is still an answer we should not re-ask on this visit.
    */
    setDeferred(null);
  }, [deferred]);

  if (!deferred) return null;

  return (
    <div
      role="region"
      aria-label={t('ariaLabel')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white px-4 py-3 shadow-lg sm:inset-x-auto sm:end-4 sm:bottom-4 sm:max-w-sm sm:rounded-2xl sm:border"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700"
        >
          <Download className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-neutral-900">{t('title')}</p>
          <p className="mt-0.5 text-xs text-neutral-600">{t('body')}</p>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={install}
              className="min-h-[36px] rounded-lg bg-primary-700 px-3 text-xs font-semibold text-white hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              {t('action')}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="min-h-[36px] rounded-lg px-3 text-xs font-medium text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              {t('dismiss')}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('dismiss')}
          className="-me-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
