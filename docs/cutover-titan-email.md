# Go-Live Runbook — Titan Email (SMTP via Nodemailer)

**Status: code merged; email goes live when the mailbox + DNS below are configured and the smoke
test passes.** Unlike the payment cutover, Titan has **no provider approval gate** — the only
prerequisites are yours to satisfy (a mailbox, SPF/DKIM/DMARC, and the secrets in production).

The adapter sits behind the provider-neutral `EmailChannel` port
([email.channel.ts](../apps/api/src/notifications/channels/email.channel.ts)); switching providers
is an `EMAIL_PROVIDER` flip, not a code change.

---

## What shipped (code)

- `EMAIL_PROVIDER` selects the adapter via a factory
  ([email-channel.factory.ts](../apps/api/src/notifications/channels/email-channel.factory.ts)):
  `mock` (dev/test/CI default) · `titan` (production) · `ses` (self-documenting not-implemented
  error — the SES adapter drops in with **no interface/caller change**).
- `TitanSmtpEmailChannel` — Nodemailer over Titan SMTP, **connection-pooled**, worker-side only,
  honest `SENT` (accepted-for-relay) vs `FAILED` (→ the existing S2-B3 retry/fallback),
  attachments supported (the resume PDF), no PII logged (recipient reduced to a hash + domain).
- `BounceHandler` seam ([bounce-handler.port.ts](../apps/api/src/notifications/channels/bounce-handler.port.ts))
  — a **documented no-op under Titan** (see the asymmetry below); SES fills it later.
- The port, worker flow, notification matrix, and every caller are **unchanged** — this is a
  channel swap behind the existing seam.

## Configuration (production secret store — values by name only)

| Env var | Meaning | Notes |
| --- | --- | --- |
| `EMAIL_PROVIDER` | `titan` in production | `mock` in dev/test/CI (the default) |
| `TITAN_SMTP_HOST` | `smtp.titan.email` | Titan's SMTP endpoint |
| `TITAN_SMTP_PORT` | `465` (SSL) or `587` (STARTTLS) | adapter sets `secure`/`requireTLS` from the port |
| `TITAN_SMTP_USER` | the Titan mailbox login | |
| `TITAN_SMTP_PASS` | the Titan mailbox password / app password | secret store only |
| `EMAIL_FROM` | the authorized sender (the Titan mailbox) | **adapter config, never a per-call field** |

The adapter **throws loudly at worker startup** if `EMAIL_PROVIDER=titan` and any of
`TITAN_SMTP_HOST/USER/PASS` or `EMAIL_FROM` is missing — no silent black hole.

## DNS — the real deliverability prerequisite (do this BEFORE the smoke test)

Transactional mail without authentication lands in spam. On the sending domain:

- [ ] **SPF** — authorize Titan to send for the domain (Titan's published `include:`).
- [ ] **DKIM** — add Titan's DKIM key; signing enabled on the mailbox.
- [ ] **DMARC** — a `_dmarc` policy (start `p=none` to observe, tighten later).
- [ ] Confirm alignment (SPF/DKIM pass for `EMAIL_FROM`'s domain).

## Smoke test (the go-live step — NOT in the automated suite)

Run with `EMAIL_PROVIDER=titan` and the real secrets, sending to an inbox you control. For each,
confirm it **arrives in the INBOX, not spam** (this is what validates SPF/DKIM/DMARC):

| Notification type | Trigger | Arrived | Inbox (not spam) |
| --- | --- | --- | --- |
| Employer approval | approve a pending employer | ☐ | ☐ |
| OTP-via-email fallback | login where WhatsApp is unavailable | ☐ | ☐ |
| Passport-expiry reminder | the cron / a manual enqueue | ☐ | ☐ |
| Subscription purchased | a paid activation | ☐ | ☐ |
| Resume (email-to-self) | `POST /candidates/me/resume/send-email` | ☐ | ☐ |

- [ ] The resume email carries the **PDF attachment** (open it — the resume renders).
- [ ] A forced bad send (e.g. an invalid recipient) marks the `email_messages` row **FAILED** and
      the S2-B3 retry/fallback runs — no false `SENT`.
- [ ] Worker logs show `email SENT type=… to=<hash>@<domain>` — **no full address, no body**.

> Note on the resume attachment: the channel **supports** attachments today (proven in
> `titan-smtp-email.channel.spec.ts`). Wiring the resume processor to actually fetch the PDF from
> R2 and pass it via `payload.attachments` is a small caller-side follow-up — it needs **no port
> or adapter change** (the `attachments` reserved key already exists). Until then the resume email
> sends without the file attached.

## The one honest asymmetry — bounces

Titan returns bounces as **ordinary email to the sending mailbox**, not a structured stream. So:

- **Under Titan, bounce handling is manual:** a human monitors the `EMAIL_FROM` mailbox for
  bounce-backs and acts (suppress, investigate) by hand. `BounceHandler` is a documented **no-op**.
- **When SES lands,** its SNS bounce/complaint stream wires to the same `BounceHandler` seam
  (suppress + alert) as an addition — no retrofit.
- [ ] Operational owner assigned to watch the `EMAIL_FROM` mailbox for bounces: `__________`

## The daily send limit — the SES-migration trigger

Titan caps per-mailbox daily volume (plan-dependent, typically low hundreds). A fan-out burst — a
wave of approvals, or the passport-expiry cron batch — can approach it. The BullMQ email queue is
the rate-limit seam if needed. **Hitting this ceiling is the documented trigger to migrate to
SES** (higher limits + the structured bounce stream). The migration is: add `SesEmailChannel`
implementing `EmailChannel`, add a `case 'ses'` to the factory, wire its SNS stream to
`BounceHandler` — no interface or caller change.

## Rollback

- **Instant:** set `EMAIL_PROVIDER=mock` in production (a config flip, no redeploy if your
  platform hot-reloads env) → emails stop leaving the system; the worker no longer opens SMTP.
  Existing flows keep running against the mock (recorded, not sent).
- No schema/data changes ship with this unit, so there is nothing to migrate back.
