import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // Google OAuth (candidates only)
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
  GOOGLE_OAUTH_CALLBACK_URL: z.string().url(),

  // Frontend base URL — OAuth redirect + CORS origin
  WEB_APP_URL: z.string().url(),

  // Cloudflare R2 (S3-compatible object storage for documents, photos, resumes)
  // Local dev can point at an R2 dev bucket or any S3-compatible mock (e.g. MinIO).
  //
  // OPTIONAL AT BOOT so an environment without object storage can still start
  // (same rationale as STRIPE_SECRET_KEY below). Absence is enforced at USE
  // time: StorageService.requireClient() throws a clear STORAGE_NOT_CONFIGURED
  // error rather than letting the AWS SDK fail with an opaque credentials
  // message. WITHOUT THESE, EVERY DOCUMENT UPLOAD FAILS — which blocks employer
  // registration (registration certificate) and candidate apply (mandatory
  // documents). Set them before those flows are needed.
  R2_ACCOUNT_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  R2_ACCESS_KEY_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  R2_SECRET_ACCESS_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  R2_BUCKET: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  R2_ENDPOINT: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),

  // Payments (S5-B1). Razorpay is the LOCKED PRIMARY gateway.
  // Stripe is the hedge for FOREIGN companies: OPTIONAL at boot, required at
  // routing (RoutingService selects Stripe only when the key exists AND the
  // payments.stripe_enabled setting is on).
  //
  // Razorpay is now OPTIONAL AT BOOT too, matching what the adapter already
  // does: RazorpayAdapter builds no client when the key is absent, exposes
  // `isConfigured === false`, and createOrder() throws an explicit error. So an
  // environment without payment credentials starts cleanly and only checkout
  // is unavailable — the schema previously blocked boot for no reason.
  RAZORPAY_KEY_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  RAZORPAY_KEY_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  // Empty string ≡ absent — `.env` files commonly leave optional keys blank
  // (`STRIPE_SECRET_KEY=`), and a blank key must not construct a Stripe client.
  STRIPE_SECRET_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),

  // Webhooks (S5-B2). Razorpay's webhook secret is required (the locked
  // primary). Stripe's is OPTIONAL and PAIRED with STRIPE_SECRET_KEY — the
  // pairing is enforced at USE time (StripeAdapter.verifyWebhook throws a
  // clear config error if events arrive without the secret), not here: a
  // zod .refine would wrap the object in ZodEffects and break the
  // check-env-drift script's `.shape` introspection.
  RAZORPAY_WEBHOOK_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  STRIPE_WEBHOOK_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),

  // Email channel (behind the provider-neutral EmailChannel port).
  // EMAIL_PROVIDER selects the adapter; `mock` is the safe default for
  // dev/test/CI. Every provider's credentials are OPTIONAL at boot (a `mock`
  // deploy needs none) and REQUIRED-AT-USE: each adapter throws loudly at
  // construction when its own values are missing (email-channel.factory.ts).
  // Secrets are referenced BY NAME only — the values live in the secret store.
  //
  // PRODUCTION USES `resend`. The worker's host silently drops outbound SMTP
  // (465/587/25 all time out; :443 is open), so the SMTP adapter cannot work
  // there no matter how it is configured. `titan` is retained for hosts that
  // permit SMTP.
  EMAIL_PROVIDER: z.enum(['resend', 'titan', 'ses', 'mock']).default('mock'),
  RESEND_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  // Overridable only to point tests/staging at a stub; production uses the default.
  RESEND_ENDPOINT: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  RESEND_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  TITAN_SMTP_HOST: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  TITAN_SMTP_PORT: z.coerce.number().int().positive().default(465),
  TITAN_SMTP_USER: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  TITAN_SMTP_PASS: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  // The authorized sender — a mailbox on a domain VERIFIED with the provider.
  // ADAPTER CONFIG, never a per-call field; keeping FROM out of call sites is
  // what made the Titan→Resend swap touch zero callers.
  EMAIL_FROM: z.preprocess((v) => (v === '' ? undefined : v), z.string().email().optional()),

  // ── WhatsApp (Meta Cloud API) — CR-WA W1 ────────────────────────────────────
  // WHATSAPP_PROVIDER selects the adapter; `mock` is the safe default and the
  // ROLLBACK. Credentials are OPTIONAL at boot (a `mock` deploy needs none) and
  // REQUIRED-AT-USE: MetaWhatsappChannel throws at construction if either is
  // missing, so a `meta` deploy fails loudly rather than silently sending nothing.
  //
  // ⚠️ THESE ARE NEEDED ON *BOTH* SERVICES. The worker sends notifications, and
  // the API sends login OTPs inline (the documented exception in
  // worker-and-external-sends.md). Setting them on only one leaves the other
  // silently on the mock — real notifications but no OTPs, or the reverse.
  WHATSAPP_PROVIDER: z.enum(['meta', 'mock']).default('mock'),
  WHATSAPP_ACCESS_TOKEN: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  WHATSAPP_PHONE_NUMBER_ID: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  // Pinned deliberately: Meta deprecates Graph versions on a schedule, and an
  // unpinned version changes payload behaviour under you.
  WHATSAPP_GRAPH_VERSION: z.string().min(1).default('v21.0'),
  // An EXPLICIT timeout. The OTP send is on the auth request path, so an
  // unbounded wait is a hung login, not just a slow job.
  WHATSAPP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // The locale templates are requested in. ⚠️ PART OF A TEMPLATE'S IDENTITY to
  // Meta — `en` and `en_US` are DIFFERENT templates, and a mismatch fails with
  // 404 / code 132001 "template name does not exist in <locale>", which reads
  // like the template is missing rather than mis-localed. Default `en_US`
  // because that is what WhatsApp Manager produces unless you deliberately pick
  // plain "English"; read the real value off the template and override here.
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().min(1).default('en_US'),
  // ── The delivery webhook (CR-WA W2) — read by the API process ──────────────
  // A secret YOU invent and paste into the Meta dashboard; the two must match
  // exactly or every verification attempt fails with a generic error.
  WHATSAPP_VERIFY_TOKEN: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  // Meta's App Secret — signs the callback body (X-Hub-Signature-256). Absent
  // means the webhook FAILS CLOSED and rejects everything; it never means
  // "accept unsigned".
  WHATSAPP_APP_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),

  // ── Local-dev fixed OTP (see OtpService.devFixedCode) ───────────────────────
  // A known code that every issued OTP becomes, so a developer running the MOCK
  // WhatsApp channel — which delivers no message — is never blocked at the
  // code-entry box. OPTIONAL. Kept a loose string here (not a 6-digit regex) so a
  // typo can't crash boot: OtpService validates the format and ignores a bad
  // value. Double-gated in code — inert unless WHATSAPP_PROVIDER≠meta AND
  // NODE_ENV≠production — so a stray value in a real environment does nothing.
  OTP_DEV_CODE: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),

  // S7-B1: WORKER-only Chromium. OPTIONAL — when absent, puppeteer uses its
  // own downloaded Chrome (local dev). The alpine container sets it to the
  // apk-installed binary (/usr/bin/chromium-browser) because the image build
  // skips puppeteer's download (PUPPETEER_SKIP_DOWNLOAD). Read only by the
  // worker's BrowserPoolService; the API process never launches a browser.
  CHROMIUM_EXECUTABLE_PATH: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),

  // ── S8-H1: performance tuning knobs ──────────────────────────────────────
  // All OPTIONAL with the pre-S8 hard-coded values as defaults, so an unset
  // environment behaves exactly as it did before. They are read directly from
  // process.env (apps/api/src/pdf/render-tuning.ts and
  // apps/api/src/core/config/rate-limits.ts) rather than through this schema,
  // because both are consumed in DECORATOR arguments — evaluated before Nest's
  // DI container exists. They are declared here so `.env.example` stays the
  // single documented inventory of the platform's configuration.
  //
  // Sizing guidance lives in docs/performance-report.md. The one that carries
  // real risk is RENDER_POOL_CONCURRENCY: it is a MEMORY knob, not a
  // throughput knob, and must be set against the worker container's limit.
  RENDER_POOL_CONCURRENCY: z.coerce.number().int().positive().default(2),
  RENDER_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  RENDER_RECYCLE_AFTER: z.coerce.number().int().positive().default(50),
  RESUME_RENDER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  INVOICE_RENDER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  RATE_LIMIT_GLOBAL_PER_MIN: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_SEARCH_PER_MIN: z.coerce.number().int().positive().default(30),

  // ── Redis command budget + metrics cadence ───────────────────────────────
  // Same discipline as the render/rate-limit knobs above: read directly from
  // process.env at the read sites (queue/worker-tuning.ts, observability), and
  // DECLARED here so `.env.example` stays the single documented inventory.
  // Full derivation: docs/redis-command-budget.md.
  BULL_DRAIN_DELAY_S: z.coerce.number().int().positive().default(60),
  BULL_MAINTENANCE_DRAIN_DELAY_S: z.coerce.number().int().positive().default(300),
  BULL_STALLED_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  BULL_MAINTENANCE_STALLED_INTERVAL_MS: z.coerce.number().int().positive().default(600_000),
  METRICS_PROCESS_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  METRICS_QUEUE_INTERVAL_MS: z.coerce.number().int().positive().default(600_000),
  // on | off — blank means "default per SIC_PROCESS_ROLE" (worker-only), so it
  // is optional rather than defaulted to a fixed value here.
  METRICS_QUEUE_COLLECTION: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['on', 'off']).optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;
