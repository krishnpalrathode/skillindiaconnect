'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { saveJob, unsaveJob } from '@/lib/api/jobs';
import { cn } from '@/lib/utils';

interface SaveJobButtonProps {
  jobId: string;
  /** From JobCard/JobDetail's `isSaved` — null means unauthenticated SSR render (unknown). */
  initialSaved: boolean | null;
  variant?: 'icon' | 'full';
  className?: string;
}

/**
 * Logged-in candidates get an optimistic toggle (rolled back on request
 * failure). Logged-out viewers are redirected to /login?next=<this job>
 * instead of triggering a request — viewing a job is always public, only
 * saving requires auth, so this is the one place that gate applies.
 */
export function SaveJobButton({
  jobId,
  initialSaved,
  variant = 'full',
  className,
}: SaveJobButtonProps) {
  const t = useTranslations('jobs.card');
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const [saved, setSaved] = useState(initialSaved ?? false);
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (!user) {
      router.push(`/${locale}/login?next=${encodeURIComponent(`/${locale}/jobs/${jobId}`)}`);
      return;
    }

    const next = !saved;
    setSaved(next);
    setPending(true);
    try {
      if (next) {
        await saveJob(jobId);
      } else {
        await unsaveJob(jobId);
      }
    } catch {
      setSaved(!next);
    } finally {
      setPending(false);
    }
  }

  const label = saved ? t('unsave') : t('save');

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-pressed={saved}
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex size-11 shrink-0 items-center justify-center rounded-md transition-colors',
          'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
          'disabled:opacity-50',
          saved && 'text-primary-600',
          className,
        )}
      >
        {saved ? (
          <BookmarkCheck className="size-5" aria-hidden="true" />
        ) : (
          <Bookmark className="size-5" aria-hidden="true" />
        )}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant={saved ? 'outline' : 'secondary'}
      onClick={handleClick}
      loading={pending}
      aria-pressed={saved}
      className={className}
    >
      {saved ? (
        <BookmarkCheck className="size-4" aria-hidden="true" />
      ) : (
        <Bookmark className="size-4" aria-hidden="true" />
      )}
      {label}
    </Button>
  );
}
