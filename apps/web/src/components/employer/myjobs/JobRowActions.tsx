'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import {
  Eye,
  Pencil,
  PauseCircle,
  PlayCircle,
  Archive,
  Copy,
  Send,
  MoreHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { PublishErrorHandler } from '@/components/employer/jobform/PublishErrorHandler';
import {
  pauseJob,
  resumeJobAction,
  archiveJob,
  duplicateJob,
  publishJob,
  type Job,
} from '@/lib/api/jobs-employer';
import { ApiRequestError } from '@/lib/api/client';

interface JobRowActionsProps {
  job: Job;
  onJobUpdated: (updated: Job) => void;
  onJobCreated?: (created: Job) => void;
}

/**
 * Every lifecycle action reuses one `run()`, so the confirmation copy is keyed
 * off the same label that drives the busy spinner — there is no way to add an
 * action here and forget to confirm it.
 */
const RESULT_TOAST = {
  publish: 'jobPublished',
  pause: 'jobPaused',
  resume: 'jobResumed',
  archive: 'jobArchived',
} as const;

type ActionLabel = keyof typeof RESULT_TOAST;

export function JobRowActions({ job, onJobUpdated, onJobCreated }: JobRowActionsProps) {
  const t = useTranslations('myjobs.actions');
  const tToast = useTranslations('toast');
  const { showToast } = useToast();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';
  const router = useRouter();

  const [loading, setLoading] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<import('@/lib/api/client').ApiError | null>(
    null,
  );

  const run = async (label: ActionLabel, fn: () => Promise<Job | void>) => {
    setLoading(label);
    setPublishError(null);
    try {
      const result = await fn();
      if (result) onJobUpdated(result);
      showToast({ message: tToast(RESULT_TOAST[label]) });
    } catch (err) {
      if (label === 'publish' && err instanceof ApiRequestError) {
        setPublishError(err.error);
      } else {
        // Everything that is NOT publish used to fail in total silence — an
        // Archive that the server rejected looked exactly like an Archive that
        // worked. Publish keeps its richer inline gate explainer; the rest get
        // an honest toast rather than nothing.
        showToast({ message: tToast('actionFailed'), variant: 'error' });
      }
    } finally {
      setLoading(null);
    }
  };

  const handleDuplicate = async () => {
    setLoading('duplicate');
    setPublishError(null);
    try {
      const copy = await duplicateJob(job.id);
      onJobCreated?.(copy);
      showToast({ message: tToast('jobDuplicated') });
    } catch {
      showToast({ message: tToast('actionFailed'), variant: 'error' });
    } finally {
      setLoading(null);
    }
  };

  const isLoading = (key: string) => loading === key;
  const busy = loading !== null;

  const viewHref = `/${locale}/jobs/${job.id}`;
  const editHref = `/${locale}/employer/jobs/${job.id}/edit`;

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label={t('groupLabel', { title: job.title })}
      >
        {/* View — available for ACTIVE and PENDING_REVIEW */}
        {job.status === 'ACTIVE' && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => router.push(viewHref)}
            aria-label={t('viewLabel', { title: job.title })}
            className="min-h-[36px]"
          >
            <Eye className="size-3.5" aria-hidden="true" />
            {t('view')}
          </Button>
        )}

        {/* Edit — available for DRAFT, ACTIVE, PAUSED */}
        {(job.status === 'DRAFT' || job.status === 'ACTIVE' || job.status === 'PAUSED') && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => router.push(editHref)}
            aria-label={t('editLabel', { title: job.title })}
            className="min-h-[36px]"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            {t('edit')}
          </Button>
        )}

        {/* Publish — DRAFT only */}
        {job.status === 'DRAFT' && (
          <Button
            type="button"
            size="sm"
            onClick={() => run('publish', () => publishJob(job.id))}
            disabled={busy}
            aria-label={t('publishLabel', { title: job.title })}
            className="min-h-[36px]"
          >
            {isLoading('publish') ? (
              <Spinner size={14} label="" />
            ) : (
              <Send className="size-3.5" aria-hidden="true" />
            )}
            {t('publish')}
          </Button>
        )}

        {/* Pause — ACTIVE only */}
        {job.status === 'ACTIVE' && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => run('pause', () => pauseJob(job.id))}
            disabled={busy}
            aria-label={t('pauseLabel', { title: job.title })}
            className="min-h-[36px]"
          >
            {isLoading('pause') ? (
              <Spinner size={14} label="" />
            ) : (
              <PauseCircle className="size-3.5" aria-hidden="true" />
            )}
            {t('pause')}
          </Button>
        )}

        {/* Resume — PAUSED only */}
        {job.status === 'PAUSED' && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => run('resume', () => resumeJobAction(job.id))}
            disabled={busy}
            aria-label={t('resumeLabel', { title: job.title })}
            className="min-h-[36px]"
          >
            {isLoading('resume') ? (
              <Spinner size={14} label="" />
            ) : (
              <PlayCircle className="size-3.5" aria-hidden="true" />
            )}
            {t('resume')}
          </Button>
        )}

        {/* Duplicate — all except ARCHIVED */}
        {job.status !== 'ARCHIVED' && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleDuplicate}
            disabled={busy}
            aria-label={t('duplicateLabel', { title: job.title })}
            className="min-h-[36px]"
          >
            {isLoading('duplicate') ? (
              <Spinner size={14} label="" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            {t('duplicate')}
          </Button>
        )}

        {/* Archive — all except already ARCHIVED */}
        {job.status !== 'ARCHIVED' && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => run('archive', () => archiveJob(job.id))}
            disabled={busy}
            aria-label={t('archiveLabel', { title: job.title })}
            className="min-h-[36px] text-neutral-600 hover:text-error-fg"
          >
            {isLoading('archive') ? (
              <Spinner size={14} label="" />
            ) : (
              <Archive className="size-3.5" aria-hidden="true" />
            )}
            {t('archive')}
          </Button>
        )}

        {/* Archived jobs — only "Duplicate" to restore as draft */}
        {job.status === 'ARCHIVED' && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleDuplicate}
            disabled={busy}
            aria-label={t('duplicateLabel', { title: job.title })}
            className="min-h-[36px]"
          >
            {isLoading('duplicate') ? (
              <Spinner size={14} label="" />
            ) : (
              <MoreHorizontal className="size-3.5" aria-hidden="true" />
            )}
            {t('repostAsDraft')}
          </Button>
        )}
      </div>

      {/* Publish error banner under the actions row */}
      {publishError && (
        <PublishErrorHandler error={publishError} onDismiss={() => setPublishError(null)} />
      )}
    </div>
  );
}
