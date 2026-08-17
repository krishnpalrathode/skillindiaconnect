'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Video, ArrowRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { getCandidateVideo } from '@/lib/api/candidate';
import { cn } from '@/lib/utils';

/**
 * "Upload a work video" — the prompt at the top of the dashboard.
 *
 * SHOWS UNTIL THE CANDIDATE HAS A VIDEO, then disappears permanently. That is
 * the whole rule: there is no dismiss button and no local-storage snooze,
 * because the only state that should silence this is the one we actually want
 * (a video on the profile). A dismissable version would let someone hide it and
 * never come back, which converts a prompt into a nuisance that achieved
 * nothing.
 *
 * It renders NOTHING while the status is unknown and NOTHING on a failed fetch.
 * A prompt that flashes in and then vanishes once the real status arrives looks
 * like a bug, and one that appears because a request failed would be telling
 * the candidate to do something they may already have done.
 */
export function VideoIntroPrompt({ locale }: { locale: string }) {
  const t = useTranslations('dashboard.videoPrompt');
  const [hasVideo, setHasVideo] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    getCandidateVideo()
      .then((s) => {
        if (active) setHasVideo(!!s.hasVideo);
      })
      .catch(() => {
        // Unknown stays unknown — see the docblock. Never guess "no video".
        if (active) setHasVideo(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (hasVideo !== false) return null;

  return (
    <section
      aria-labelledby="video-prompt-title"
      className="flex flex-col gap-4 rounded-2xl border border-accent-200 bg-gradient-to-br from-accent-50 to-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-100 text-accent-700"
          aria-hidden="true"
        >
          <Video className="size-5" />
        </span>
        <div className="min-w-0">
          <p id="video-prompt-title" className="text-sm font-bold text-neutral-900">
            {t('title')}
          </p>
          <p className="mt-0.5 text-sm leading-snug text-neutral-700">{t('body')}</p>
        </div>
      </div>

      {/*
        Links to the profile page's video block by fragment, not just to the
        profile. The video sits well down that page behind the documents, so
        dropping someone at the top and letting them hunt for it is how a
        prompt gets ignored. `scroll-mt-24` on the target keeps the sticky
        header from covering it on arrival.
      */}
      <Link
        href={`/${locale}/profile#video-intro`}
        className={cn(
          buttonVariants({ variant: 'primary', size: 'md' }),
          'group shrink-0 rounded-xl font-bold',
        )}
      >
        {t('cta')}
        <ArrowRight
          className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
          aria-hidden="true"
        />
      </Link>
    </section>
  );
}
