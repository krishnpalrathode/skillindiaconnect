'use client';

import React, { useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Upload, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { useEmployerCertUpload } from '@/lib/employer/useEmployerCertUpload';

interface CertificateUploadProps {
  /**
   * When true (resubmit — company exists), runs the full presign→PUT→confirm chain.
   * When false (initial registration), runs presign→PUT only and returns the key
   * for inclusion in POST /employers/register.
   */
  confirmEnabled?: boolean;
  onKey: (key: string) => void;
  error?: string;
  className?: string;
}

const MAX_MB = 10;

/**
 * Employer registration certificate upload widget.
 * Wraps useEmployerCertUpload (same resilient state machine as F2's useUpload):
 * presign → PUT directly to R2 → optional confirm. Interrupted PUT retries without
 * file re-selection; expired presign URL is automatically re-fetched on retry.
 */
export function CertificateUpload({
  confirmEnabled = true,
  onKey,
  error,
  className,
}: CertificateUploadProps) {
  const t = useTranslations('employer.onboarding');
  const tUpload = useTranslations('onboarding.upload');
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const { state, run, retry, reset } = useEmployerCertUpload({ confirmEnabled });

  const errorId = error ? `${id}-error` : undefined;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (inputRef.current) inputRef.current.value = '';
    if (file.size > MAX_MB * 1024 * 1024) return;
    await run(file);
  };

  React.useEffect(() => {
    if (state.status === 'done' && state.key) {
      onKey(state.key);
    }
  }, [state.status, state.key, onKey]);

  const isActive =
    state.status === 'presigning' || state.status === 'uploading' || state.status === 'confirming';

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-neutral-700">
          {t('certLabel')}
          <span className="ms-1 text-error-fg" aria-hidden="true">
            *
          </span>
        </span>
        {state.status === 'done' && (
          <Badge variant="success" className="text-xs">
            <CheckCircle className="size-3" aria-hidden="true" />
            {tUpload('uploadComplete')}
          </Badge>
        )}
      </div>

      <p className="text-xs text-neutral-500">{t('certHint')}</p>

      <button
        type="button"
        disabled={isActive}
        onClick={() => {
          if (state.status === 'error') retry();
          else inputRef.current?.click();
        }}
        aria-label={
          state.status === 'error'
            ? tUpload('retryUpload')
            : state.status === 'done'
              ? tUpload('changeFile')
              : tUpload('selectFile')
        }
        aria-describedby={errorId}
        className={cn(
          'relative flex flex-col items-center justify-center gap-2',
          'w-full min-h-[96px] rounded-lg border-2 border-dashed',
          'transition-colors text-sm font-medium',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
          state.status === 'done'
            ? 'border-success-fg/40 bg-success-bg/30 text-success-fg'
            : state.status === 'error' || error
              ? 'border-error/50 bg-error-bg/30 text-error-fg cursor-pointer hover:bg-error-bg/50'
              : 'border-border bg-neutral-50 text-neutral-500 hover:border-primary-400 hover:bg-primary-50 cursor-pointer',
          isActive && 'cursor-wait pointer-events-none',
        )}
      >
        {state.status === 'idle' && (
          <>
            <Upload className="size-5 text-neutral-400" aria-hidden="true" />
            <span>{tUpload('dropzoneHint')}</span>
            <span className="text-xs text-neutral-400">{tUpload('maxSize', { size: MAX_MB })}</span>
          </>
        )}

        {(state.status === 'presigning' || state.status === 'confirming') && (
          <Spinner size={20} label={tUpload('uploading', { pct: 0 })} />
        )}

        {state.status === 'uploading' && (
          <div className="flex flex-col items-center gap-1.5 w-full px-4">
            <Spinner size={20} label={tUpload('uploading', { pct: state.progress })} />
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
              {tUpload('uploading', { pct: state.progress })}
            </span>
          </div>
        )}

        {state.status === 'done' && (
          <>
            <CheckCircle className="size-5 text-success-fg" aria-hidden="true" />
            <span>{tUpload('uploadComplete')}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                reset();
                inputRef.current?.click();
              }}
              className="text-xs text-neutral-500 underline hover:text-neutral-700"
            >
              {tUpload('changeFile')}
            </button>
          </>
        )}

        {state.status === 'error' && (
          <>
            <AlertCircle className="size-5 text-error-fg" aria-hidden="true" />
            <span>{state.errorMessage ?? tUpload('uploadFailed')}</span>
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
                {tUpload('retryUpload')}
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
                {tUpload('selectFile')}
              </Button>
            </div>
          </>
        )}
      </button>

      {error && !state.status.match(/done|uploading|presigning|confirming/) && (
        <p id={errorId} role="alert" className="text-xs text-error-fg font-medium">
          {error}
        </p>
      )}

      <input
        ref={inputRef}
        id={id}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        className="sr-only"
        onChange={handleFileChange}
        aria-label={t('certLabel')}
      />
    </div>
  );
}
