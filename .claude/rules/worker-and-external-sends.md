# Worker-only external sends

The API process NEVER calls external send services (Meta WhatsApp Cloud API, AWS
SES) and never runs heavy or long work inline. It writes state and enqueues a
BullMQ job. The WORKER process owns all external sends and async/retryable work.

**The only synchronous external calls the API may make:**

- R2 presigning (local signing, no network round-trip), and
- payment order/checkout-session creation (the user is waiting at checkout).

Why: protect request latency, and let the API scale horizontally without
duplicate side effects.

Delivery tracking: WhatsApp/email rows (`whatsapp_messages`, `email_messages`)
carry a delivery status updated by provider webhooks. Fallbacks follow the
notification matrix — WhatsApp-tier events downgrade to email when
`whatsappCapable = false` or after send retries fail. Never silently claim a
notification was delivered.
