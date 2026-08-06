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
  /** Blocks file selection — used when a prerequisite (e.g. passport expiry) is unset. */
  disabled?: boolean;
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
  disabled = false,
  onDone,
  className,
}: FileUploadProps) {
  const t = useTranslations('onboarding.upload');
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const { state, run, retry, reset } = useUpload(docType, expiryDate);

  // Read the latest onDone from a ref so the transition effect below doesn't
  // re-fire just because the parent passed a new callback identity on re-render.
  const onDoneRef = useRef(onDone);
  React.useEffect(() => {
    onDoneRef.current = onDone;
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Clear input value so re-selecting the same file still fires onChange
    if (inputRef.current) inputRef.current.value = '';

    if (file.size > maxMb * 1024 * 1024) {
      return;
    }

    await run(file);
  };

  // Call onDone when status transitions to done
  React.useEffect(() => {
    if (state.status === 'done' && state.document) {
      onDoneRef.current?.(state.document.key);
    }
  }, [state.status, state.document]);

  const isActive =
    state.status === 'presigning' || state.status === 'uploading' || state.status === 'confirming';
  // `disabled` blocks selection AND retry: retrying without the missing prerequisite
  // just reproduces the same server-side rejection.
  const isInert = isActive || disabled;

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

      {hint && <p className="text-xs text-neutral-600">{hint}</p>}

      {/* Drop zone / trigger — div+role to avoid <button> nesting in done/error states */}
      <div
        role="button"
        tabIndex={isInert ? -1 : 0}
        aria-disabled={isInert}
        aria-label={
          state.status === 'error'
            ? t('retryUpload')
            : state.status === 'done'
              ? t('changeFile')
              : t('selectFile')
        }
        onClick={() => {
          if (isInert) return;
          if (state.status === 'error') {
            retry();
          } else if (state.status !== 'done') {
            inputRef.current?.click();
          }
        }}
        onKeyDown={(e) => {
          if (isInert) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (state.status === 'error') retry();
            else if (state.status !== 'done') inputRef.current?.click();
          }
        }}
        className={cn(
          'relative flex flex-col items-center justify-center gap-2.5',
          'w-full min-h-[128px] rounded-[22px] border-2 border-dashed px-4 py-5',
          'text-sm font-medium transition-all duration-200',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
          state.status === 'done'
            ? 'border-success-fg/40 bg-success-bg/30 text-success-fg'
            : state.status === 'error'
              ? 'border-error/50 bg-error-bg/30 text-error-fg cursor-pointer hover:bg-error-bg/50'
              : 'cursor-pointer border-neutral-200 bg-neutral-50/60 text-neutral-600 hover:border-[#0F3D91]/40 hover:bg-[#E8F0FE]/40 hover:shadow-sm',
          isActive && 'cursor-wait pointer-events-none',
          disabled &&
            !isActive &&
            'cursor-not-allowed opacity-60 hover:border-neutral-200 hover:bg-neutral-50/60 hover:shadow-none',
        )}
      >
        {state.status === 'idle' && (
          <>
            <span
              className="flex size-12 items-center justify-center rounded-full bg-[#E8F0FE] text-[#0F3D91]"
              aria-hidden="true"
            >
              <Upload className="size-5" />
            </span>
            <span className="font-semibold text-neutral-700">{t('dropzoneHint')}</span>
            <span className="text-xs text-neutral-600">{t('maxSize', { size: maxMb })}</span>
          </>
        )}

        {(state.status === 'presigning' || state.status === 'confirming') && (
          <Spinner size={20} label={t('uploading', { pct: 0 })} />
        )}

        {state.status === 'uploading' && (
          <div className="flex flex-col items-center gap-1.5 w-full px-4">
            <Spinner size={20} label={t('uploading', { pct: state.progress })} />
            <div className="h-2 w-full rounded-full bg-neutral-200">
              <div
                role="progressbar"
                aria-valuenow={state.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-2 rounded-full bg-gradient-to-r from-[#0F3D91] to-[#2E67B1] transition-all"
                style={{ width: `${state.progress}%` }}
              />
            </div>
            <span className="text-xs text-neutral-600">
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
              className="text-xs text-neutral-600 underline hover:text-neutral-700"
            >
              {t('changeFile')}
            </button>
          </>
        )}

        {state.status === 'error' && (
          <>
            <AlertCircle className="size-5 text-error-fg" aria-hidden="true" />
            <span>
              {state.errorCode === 'FILE_TOO_LARGE'
                ? t('errFileTooLarge', { max: maxMb })
                : state.errorCode === 'INVALID_FILE_TYPE'
                  ? t('errInvalidType')
                  : state.errorCode === 'UPLOAD_NOT_FOUND'
                    ? t('errUploadIncomplete')
                    : (state.errorMessage ?? t('uploadFailed'))}
            </span>
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
      </div>

      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={handleFileChange}
        aria-label={label}
      />
    </div>
  );
}
