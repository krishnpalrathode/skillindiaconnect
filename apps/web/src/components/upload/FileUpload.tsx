'use client';

import React, { useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Upload, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { useUpload } from './useUpload';
import type { PresignRequest } from '@/lib/api/candidate';

type DocType = PresignRequest['type'];

interface FileUploadProps {
  docType: DocType;
  accept?: string;
  maxMb?: number;
  label: string;
  hint?: string;
  expiryDate?: string;
  onDone?: (key: string) => void;
  className?: string;
}

/**
 * Document upload widget backed by useUpload state machine.
 *
 * - Presigns → uploads directly to R2 → confirms with the API
 * - Shows progress during upload (XHR progress events)
 * - On error: shows a "Retry" button without requiring file re-selection
 * - Re-presigns automatically if the signed URL is expired on retry
 */
export function FileUpload({
  docType,
  accept = '.pdf,image/*',
  maxMb = 5,
  label,
  hint,
  expiryDate,
  onDone,
  className,
}: FileUploadProps) {
  const t = useTranslations('onboarding.upload');
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const { state, run, retry, reset } = useUpload(docType, expiryDate);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Clear input value so re-selecting the same file still fires onChange
    if (inputRef.current) inputRef.current.value = '';

    if (file.size > maxMb * 1024 * 1024) {
      return;
    }

    await run(file);
    if (state.status === 'done' && state.document) {
      onDone?.(state.document.key);
    }
  };

  // Call onDone when status transitions to done
  React.useEffect(() => {
    if (state.status === 'done' && state.document) {
      onDone?.(state.document.key);
    }
  }, [state.status, state.document, onDone]);

  const isActive =
    state.status === 'presigning' || state.status === 'uploading' || state.status === 'confirming';

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-neutral-700">{label}</span>
        {state.status === 'done' && (
          <Badge variant="success" className="text-xs">
            <CheckCircle className="size-3" aria-hidden="true" />
            {t('uploadComplete')}
          </Badge>
        )}
      </div>

      {hint && <p className="text-xs text-neutral-500">{hint}</p>}

      {/* Drop zone / trigger */}
      <button
        type="button"
        disabled={isActive}
        onClick={() => {
          if (state.status === 'error') {
            retry();
          } else {
            inputRef.current?.click();
          }
        }}
        aria-label={
          state.status === 'error'
            ? t('retryUpload')
            : state.status === 'done'
              ? t('changeFile')
              : t('selectFile')
        }
        className={cn(
          'relative flex flex-col items-center justify-center gap-2',
          'w-full min-h-[96px] rounded-lg border-2 border-dashed',
          'transition-colors text-sm font-medium',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
          state.status === 'done'
            ? 'border-success-fg/40 bg-success-bg/30 text-success-fg'
            : state.status === 'error'
              ? 'border-error/50 bg-error-bg/30 text-error-fg cursor-pointer hover:bg-error-bg/50'
              : 'border-border bg-neutral-50 text-neutral-500 hover:border-primary-400 hover:bg-primary-50 cursor-pointer',
          isActive && 'cursor-wait pointer-events-none',
        )}
      >
        {state.status === 'idle' && (
          <>
            <Upload className="size-5 text-neutral-400" aria-hidden="true" />
            <span>{t('dropzoneHint')}</span>
            <span className="text-xs text-neutral-400">{t('maxSize', { size: maxMb })}</span>
          </>
        )}

        {(state.status === 'presigning' || state.status === 'confirming') && (
          <Spinner size={20} label={t('uploading', { pct: 0 })} />
        )}

        {state.status === 'uploading' && (
          <div className="flex flex-col items-center gap-1.5 w-full px-4">
            <Spinner size={20} label={t('uploading', { pct: state.progress })} />
            <div className="w-full bg-neutral-200 rounded-full h-1.5">
              <div
                role="progressbar"
                aria-valuenow={state.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 rounded-full bg-primary-600 transition-all"
                style={{ width: `${state.progress}%` }}
              />
            </div>
            <span className="text-xs text-neutral-500">
              {t('uploading', { pct: state.progress })}
            </span>
          </div>
        )}

        {state.status === 'done' && (
          <>
            <CheckCircle className="size-5 text-success-fg" aria-hidden="true" />
            <span>{t('uploadComplete')}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                reset();
                inputRef.current?.click();
              }}
              className="text-xs text-neutral-500 underline hover:text-neutral-700"
            >
              {t('changeFile')}
            </button>
          </>
        )}

        {state.status === 'error' && (
          <>
            <AlertCircle className="size-5 text-error-fg" aria-hidden="true" />
            <span>{state.errorMessage ?? t('uploadFailed')}</span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  retry();
                }}
              >
                <RefreshCw className="size-3" aria-hidden="true" />
                {t('retryUpload')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  reset();
                  inputRef.current?.click();
                }}
              >
                {t('selectFile')}
              </Button>
            </div>
          </>
        )}
      </button>

      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={handleFileChange}
        aria-label={label}
      />
    </div>
  );
}
