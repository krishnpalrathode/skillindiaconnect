'use client';

import { useCallback, useRef, useState } from 'react';
import {
  presignCompanyCert,
  confirmCompanyCert,
  type CertPresignResponse,
} from '@/lib/api/employer';

export type CertUploadStatus =
  | 'idle'
  | 'presigning'
  | 'uploading'
  | 'confirming'
  | 'done'
  | 'error';

export interface CertUploadState {
  status: CertUploadStatus;
  progress: number;
  key: string | null;
  errorMessage: string | null;
}

interface UseEmployerCertUploadOptions {
  /**
   * When true (resubmit mode — company exists), the full
   * presign → PUT → confirm chain runs and the cert key is committed to the
   * company record immediately.
   *
   * When false (initial registration — company doesn't exist yet), the
   * presign → PUT chain runs and `key` is returned for the caller to include
   * in POST /employers/register.  Confirm is skipped because the company
   * record doesn't exist yet.
   */
  confirmEnabled?: boolean;
}

const INITIAL: CertUploadState = { status: 'idle', progress: 0, key: null, errorMessage: null };

/**
 * Upload state machine for the employer registration certificate.
 * Mirrors useUpload's interrupted-upload resilience pattern:
 * - Retry without re-selection (re-presign if URL expired; retry confirm if confirm failed).
 * - No infinite spinner: every failure lands in 'error' with a visible message.
 */
export function useEmployerCertUpload({
  confirmEnabled = true,
}: UseEmployerCertUploadOptions = {}) {
  const [state, setState] = useState<CertUploadState>(INITIAL);

  const storedFile = useRef<File | null>(null);
  const storedPresign = useRef<(CertPresignResponse & { issuedAt: number }) | null>(null);
  const storedKey = useRef<string | null>(null);

  const setStatus = (update: Partial<CertUploadState>) =>
    setState((prev) => ({ ...prev, ...update }));

  const doPresign = useCallback(async (file: File): Promise<CertPresignResponse> => {
    setStatus({ status: 'presigning', progress: 0, errorMessage: null });
    const resp = await presignCompanyCert({
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    });
    storedPresign.current = { ...resp, issuedAt: Date.now() };
    return resp;
  }, []);

  const doUpload = useCallback(async (file: File, uploadUrl: string): Promise<void> => {
    setStatus({ status: 'uploading', progress: 0 });
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setStatus({ progress: Math.round((e.loaded / e.total) * 100) });
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Upload failed: HTTP ${xhr.status}`));
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.onabort = () => reject(new Error('Upload aborted'));
      xhr.send(file);
    });
    setStatus({ progress: 100 });
  }, []);

  const doConfirm = useCallback(async (key: string): Promise<void> => {
    setStatus({ status: 'confirming' });
    storedKey.current = key;
    await confirmCompanyCert(key);
    storedKey.current = null;
  }, []);

  const isPresignExpired = (): boolean => {
    if (!storedPresign.current) return true;
    const elapsed = (Date.now() - storedPresign.current.issuedAt) / 1000;
    return elapsed >= storedPresign.current.expiresInSeconds - 30;
  };

  const run = useCallback(
    async (file: File) => {
      storedFile.current = file;
      storedKey.current = null;
      try {
        const presign = await doPresign(file);
        await doUpload(file, presign.uploadUrl);
        if (confirmEnabled) {
          await doConfirm(presign.key);
        }
        setState({ status: 'done', progress: 100, key: presign.key, errorMessage: null });
      } catch (err) {
        setStatus({
          status: 'error',
          errorMessage: err instanceof Error ? err.message : 'Upload failed',
        });
      }
    },
    [confirmEnabled, doPresign, doUpload, doConfirm],
  );

  const retry = useCallback(async () => {
    const file = storedFile.current;
    if (!file) return;

    if (storedKey.current) {
      try {
        setStatus({ status: 'confirming', errorMessage: null });
        await confirmCompanyCert(storedKey.current);
        setState({ status: 'done', progress: 100, key: storedKey.current, errorMessage: null });
        storedKey.current = null;
      } catch (err) {
        setStatus({
          status: 'error',
          errorMessage: err instanceof Error ? err.message : 'Confirm failed',
        });
      }
      return;
    }

    try {
      let uploadUrl: string;
      let key: string;
      if (!isPresignExpired() && storedPresign.current) {
        uploadUrl = storedPresign.current.uploadUrl;
        key = storedPresign.current.key;
        setStatus({ errorMessage: null });
      } else {
        const presign = await doPresign(file);
        uploadUrl = presign.uploadUrl;
        key = presign.key;
      }
      await doUpload(file, uploadUrl);
      if (confirmEnabled) {
        await doConfirm(key);
      }
      setState({ status: 'done', progress: 100, key, errorMessage: null });
    } catch (err) {
      setStatus({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Upload failed',
      });
    }
  }, [confirmEnabled, doPresign, doUpload, doConfirm]);

  const reset = useCallback(() => {
    storedFile.current = null;
    storedPresign.current = null;
    storedKey.current = null;
    setState(INITIAL);
  }, []);

  return { state, run, retry, reset };
}
