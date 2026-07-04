'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { presignLogo, confirmLogo, type LogoPresignResponse } from '@/lib/api/employer-profile';
import type { components } from '@skillindiaconnect/shared-types';

type EmployerProfile = components['schemas']['EmployerProfile'];

export type LogoUploadStatus =
  | 'idle'
  | 'presigning'
  | 'uploading'
  | 'confirming'
  | 'done'
  | 'error';

export interface LogoUploadState {
  status: LogoUploadStatus;
  progress: number;
  errorMessage: string | null;
}

const INITIAL: LogoUploadState = { status: 'idle', progress: 0, errorMessage: null };

/**
 * Upload state machine for the employer logo.
 *
 * Mirrors useEmployerCertUpload's interrupted-upload resilience:
 * - Retry without re-selection (re-presign if URL expired; retry confirm if failed).
 * - On successful confirm, the API returns the updated EmployerProfile — call onDone.
 * - No infinite spinner: every failure lands in 'error' with a visible message.
 */
export function useLogoUpload(onDone: (profile: EmployerProfile) => void) {
  const [state, setState] = useState<LogoUploadState>(INITIAL);

  const storedFile = useRef<File | null>(null);
  const storedPresign = useRef<(LogoPresignResponse & { issuedAt: number }) | null>(null);
  const storedKey = useRef<string | null>(null);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  const setStatus = (update: Partial<LogoUploadState>) =>
    setState((prev) => ({ ...prev, ...update }));

  const doPresign = useCallback(async (file: File): Promise<LogoPresignResponse> => {
    setStatus({ status: 'presigning', progress: 0, errorMessage: null });
    const resp = await presignLogo({
      fileName: file.name,
      mimeType: file.type || 'image/jpeg',
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
      xhr.setRequestHeader('Content-Type', file.type || 'image/jpeg');
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

  const doConfirm = useCallback(async (key: string): Promise<EmployerProfile> => {
    setStatus({ status: 'confirming' });
    storedKey.current = key;
    const profile = await confirmLogo(key);
    storedKey.current = null;
    return profile;
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
        const profile = await doConfirm(presign.key);
        setState({ status: 'done', progress: 100, errorMessage: null });
        onDoneRef.current(profile);
      } catch (err) {
        setStatus({
          status: 'error',
          errorMessage: err instanceof Error ? err.message : 'Upload failed',
        });
      }
    },
    [doPresign, doUpload, doConfirm],
  );

  const retry = useCallback(async () => {
    const file = storedFile.current;
    if (!file) return;

    if (storedKey.current) {
      try {
        setStatus({ status: 'confirming', errorMessage: null });
        const profile = await confirmLogo(storedKey.current);
        setState({ status: 'done', progress: 100, errorMessage: null });
        storedKey.current = null;
        onDoneRef.current(profile);
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
      const profile = await doConfirm(key);
      setState({ status: 'done', progress: 100, errorMessage: null });
      onDoneRef.current(profile);
    } catch (err) {
      setStatus({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Upload failed',
      });
    }
  }, [doPresign, doUpload, doConfirm]);

  const reset = useCallback(() => {
    storedFile.current = null;
    storedPresign.current = null;
    storedKey.current = null;
    setState(INITIAL);
  }, []);

  return { state, run, retry, reset };
}
