export const QUEUE_NAMES = {
  ACCOUNT_PURGE: 'account-purge',
  R2_DELETE: 'r2-delete',
  NOTIFICATION: 'notification',
  AUTO_ARCHIVE: 'auto-archive',
  PASSPORT_EXPIRY: 'passport-expiry',
  SUBSCRIPTION_LIFECYCLE: 'subscription-lifecycle',
  // S7-B1: Puppeteer renders — WORKER-consumed only (Chromium never runs in
  // the API process; the API merely enqueues onto these).
  RESUME_RENDER: 'resume-render',
  INVOICE_RENDER: 'invoice-render',
} as const;

export const JOB_NAMES = {
  PURGE_CANDIDATE: 'purge-candidate',
  // S6b-B1: daily sweep that finds PENDING_DELETION users whose 30-day grace
  // has elapsed and enqueues one PURGE_CANDIDATE job per user. Runs on the
  // ACCOUNT_PURGE queue alongside the per-user jobs.
  PURGE_SWEEP: 'purge-sweep',
  DELETE_OBJECT: 'delete-object',
  SEND_NOTIFICATION: 'send-notification',
  AUTO_ARCHIVE_JOBS: 'auto-archive-jobs',
  PASSPORT_EXPIRY_SCAN: 'passport-expiry-scan',
  SUBSCRIPTION_LIFECYCLE_SWEEP: 'subscription-lifecycle-sweep',
  // S7-B1
  GENERATE_RESUME: 'generate-resume',
  RENDER_INVOICE: 'render-invoice',
  // Daily sweep that enqueues RENDER_INVOICE for every invoice still carrying
  // pdfKey NULL — the S5-B2 backfill AND the retry net for failed renders.
  INVOICE_BACKFILL_SWEEP: 'invoice-backfill-sweep',
} as const;
