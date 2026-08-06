# Worker-only external sends

The API process NEVER calls external send services (Meta WhatsApp Cloud API, AWS
SES) and never runs heavy or long work inline. It writes state and enqueues a
BullMQ job. The WORKER process owns all external sends and async/retryable work.

**The only synchronous external calls the API may make:**

- R2 presigning (local signing, no network round-trip),
- payment order/checkout-session creation (the user is waiting at checkout), and
- **the WhatsApp OTP send** (CR-WA W1 — see below).

Why: protect request latency, and let the API scale horizontally without
duplicate side effects.

## The OTP exception (CR-WA W1)

`OtpService.sendOtp` calls the WhatsApp channel **inline, in the API process**
(`AuthModule` imports `WhatsappModule`). This has always been the code; it was
invisible while the only binding was `MockWhatsappChannel`, which makes no
network call. Binding the real Meta adapter makes it a genuine outbound HTTPS
call on the login/signup request path, so it is written down here rather than
left as a silent violation.

**Why it is allowed.** The rule already permits a synchronous external call
where the user is actively waiting — that is the stated basis for the payments
exception. An OTP is the same shape: the user is sitting at the code-entry box.
And the decisive constraint is `notOnWhatsapp`. Meta only reveals that a number
is unreachable **in its response**, and `OtpService` returns that fact to the
caller synchronously so the UI can fall back to email/SMS. Moving the send to
the queue would destroy that signal and strand users on the login screen with
no code and no fallback — a real regression for our users, not a theoretical one.

**The cost, stated plainly.** This puts a blocking Graph API call on the auth
path, on a free-tier Render instance that cold-starts. Login can feel slow until
an always-on plan. The adapter carries an explicit `WHATSAPP_TIMEOUT_MS` so the
request fails fast rather than hanging, and it returns `ok:false` instead of
throwing, so a provider failure degrades to the caller's fallback rather than
becoming a 500 on login.

**Scope of the exception: OTP only.** Every notification-tier WhatsApp send
still goes API-enqueues → worker-sends. Nothing else moves into the API.

Delivery tracking: WhatsApp/email rows (`whatsapp_messages`, `email_messages`)
carry a delivery status updated by provider webhooks. Fallbacks follow the
notification matrix — WhatsApp-tier events downgrade to email when
`whatsappCapable = false` or after send retries fail. Never silently claim a
notification was delivered.
