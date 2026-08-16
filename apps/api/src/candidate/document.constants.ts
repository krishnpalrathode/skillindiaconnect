import { MAX_UPLOAD_BYTES } from '../core/uploads';

export const ACCEPTED_DOC_TYPES = ['PASSPORT', 'EXPERIENCE_CERT', 'EDUCATIONAL_CERT'] as const;
export type AcceptedDocType = (typeof ACCEPTED_DOC_TYPES)[number];

export const ALLOWED_DOC_MIMES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

/**
 * Per-type limits. The size is the platform-wide ceiling for every type — see
 * `core/uploads.ts` for why it is one number rather than a per-type allowance.
 * `mimes` stays per-type because those genuinely could differ.
 */
export const DOC_LIMITS: Record<AcceptedDocType, { maxBytes: number; mimes: readonly string[] }> = {
  PASSPORT: { maxBytes: MAX_UPLOAD_BYTES, mimes: ALLOWED_DOC_MIMES },
  EXPERIENCE_CERT: { maxBytes: MAX_UPLOAD_BYTES, mimes: ALLOWED_DOC_MIMES },
  EDUCATIONAL_CERT: { maxBytes: MAX_UPLOAD_BYTES, mimes: ALLOWED_DOC_MIMES },
};

export const PASSPORT_DOC_TYPE = 'PASSPORT' as const;
