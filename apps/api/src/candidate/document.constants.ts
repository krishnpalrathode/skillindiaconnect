export const ACCEPTED_DOC_TYPES = ['PASSPORT', 'EXPERIENCE_CERT', 'EDUCATIONAL_CERT'] as const;
export type AcceptedDocType = (typeof ACCEPTED_DOC_TYPES)[number];

export const ALLOWED_DOC_MIMES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export const DOC_LIMITS: Record<AcceptedDocType, { maxBytes: number; mimes: readonly string[] }> = {
  PASSPORT: { maxBytes: 10 * 1024 * 1024, mimes: ALLOWED_DOC_MIMES },
  EXPERIENCE_CERT: { maxBytes: 10 * 1024 * 1024, mimes: ALLOWED_DOC_MIMES },
  EDUCATIONAL_CERT: { maxBytes: 10 * 1024 * 1024, mimes: ALLOWED_DOC_MIMES },
};

export const PASSPORT_DOC_TYPE = 'PASSPORT' as const;
