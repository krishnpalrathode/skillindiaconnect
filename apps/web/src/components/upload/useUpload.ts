import { useCallback, useRef, useState } from 'react';
import type { components } from '@skillindiaconnect/shared-types';
import { presignDocument, confirmDocument } from '@/lib/api/candidate';
import type { PresignRequest, PresignResponse } from '@/lib/api/candidate';

type CandidateDocument = components['schemas']['CandidateDocument'];
type DocType = PresignRequest['type'];

export type UploadStatus = 'idle' | 'presigning' | 'uploading' | 'confirming' | 'done' | 'error';

export interface UploadState {
  status: UploadStatus;
  progress: number;
  document: CandidateDocument | null;
  errorMessage: string | null;
}

const INITIAL: UploadState = {
  status: 'idle',
  progress: 0,
  document: null,
  errorMessage: null,
};

/**
 * Upload state machine with interrupted-upload resilience.
 *
 * Retry without re-selection:
 * - If confirm failed but upload succeeded → retry confirm with stored key.
 * - If upload failed but presign is still valid → retry upload from stored URL.
 * - If presign expired → re-presign, then upload, then confirm.
 *
 * No infinite spinner: every failure lands in 'error' with a user-visible message.
 */
export function useUpload(docType: DocType, expiryDate?: string) {
  const [state, setState] = useState<UploadState>(INITIAL);

  // Persistent across retries — cleared only on reset() or successful done
  const storedFile = useRef<File | null>(null);
  const storedPresign = useRef<(PresignResponse & { issuedAt: number }) | null>(null);
  const storedKey = useRef<string | null>(null);

  const setStatus = (update: Partial<UploadState>) => setState((prev) => ({ ...prev, ...update }));

  const doPresign = useCallback(
    async (file: File): Promise<PresignResponse> => {
      setStatus({ status: 'presigning', progress: 0, errorMessage: null });
      const resp = await presignDocument({
        type: docType,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });
      storedPresign.current = { ...resp, issuedAt: Date.now() };
      return resp;
    },
    [docType],
  );

  const doUpload = useCallback(async (file: File, uploadUrl: string): Promise<void> => {
    setStatus({ status: 'uploading', progress: 0 });

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setStatus({ progress: Math.round((e.loaded / e.total) * 100) });
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed: HTTP ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.onabort = () => reject(new Error('Upload aborted'));

      xhr.send(file);
    });

    setStatus({ progress: 100 });
  }, []);

  const doConfirm = useCallback(
    async (key: string): Promise<CandidateDocument> => {
      setStatus({ status: 'confirming' });
      storedKey.current = key;
      const doc = await confirmDocument(key, expiryDate);
      storedKey.current = null;
      return doc;
    },
    [expiryDate],
  );

  const isPresignExpired = (): boolean => {
    if (!storedPresign.current) return true;
    const elapsed = (Date.now() - storedPresign.current.issuedAt) / 1000;
    // Treat as expired 30s before actual expiry to avoid race conditions
    return elapsed >= storedPresign.current.expiresInSeconds - 30;
  };

  const run = useCallback(
    async (file: File) => {
      storedFile.current = file;
      storedKey.current = null;

      try {
        const presign = await doPresign(file);
        await doUpload(file, presign.uploadUrl);
        const doc = await doConfirm(presign.key);
        setState({ status: 'done', progress: 100, document: doc, errorMessage: null });
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

    // Case 1: confirm already ran but failed — retry confirm with stored key
    if (storedKey.current) {
      try {
        setStatus({ status: 'confirming', errorMessage: null });
        const doc = await confirmDocument(storedKey.current, expiryDate);
        setState({ status: 'done', progress: 100, document: doc, errorMessage: null });
      } catch (err) {
        setStatus({
          status: 'error',
          errorMessage: err instanceof Error ? err.message : 'Confirm failed',
        });
      }
      return;
    }

    // Case 2: upload failed; decide whether to re-presign
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
      const doc = await doConfirm(key);
      setState({ status: 'done', progress: 100, document: doc, errorMessage: null });
    } catch (err) {
      setStatus({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Upload failed',
      });
    }
  }, [expiryDate, doPresign, doUpload, doConfirm]);

  const reset = useCallback(() => {
    storedFile.current = null;
    storedPresign.current = null;
    storedKey.current = null;
    setState(INITIAL);
  }, []);

  return { state, run, retry, reset };
}
