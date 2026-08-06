# WhatsApp Integration (Meta Cloud API) — Setup & Go-Live Runbook

**Status: code merged (CR-WA W0–W3); WhatsApp goes live when the Meta setup below is
done, the env vars are set on BOTH services, and the smoke test passes.** Everything
in this repo defaults to `mock` — an unconfigured deploy sends nothing and errors
nothing, which is deliberate but means **nothing here is proven against Meta until
you run the smoke test in [Live smoke test](#live-smoke-test--fill-these-in)**.

The adapter sits behind the provider-neutral `WhatsappChannel` port
([whatsapp.channel.ts](../apps/api/src/notifications/channels/whatsapp.channel.ts));
switching providers is a `WHATSAPP_PROVIDER` flip, not a code change — the same
shape as [cutover-titan-email.md](./cutover-titan-email.md).

---

## What shipped

| Unit | What it added |
| --- | --- |
| **W0** | Template variables + documents carried across the notification seam ([notification.types.ts](../apps/api/src/notifications/notification.types.ts)); the positional `job_selected` contract in ONE place ([selected-template-vars.ts](../apps/api/src/applications/selected-template-vars.ts)) |
| **W1** | `MetaWhatsappChannel` ([meta-whatsapp.channel.ts](../apps/api/src/notifications/channels/meta-whatsapp.channel.ts)) + the template mapping ([meta-templates.ts](../apps/api/src/notifications/channels/meta-templates.ts)) + a shared factory bound in BOTH processes ([whatsapp-channel.factory.ts](../apps/api/src/notifications/channels/whatsapp-channel.factory.ts)) |
| **W1.5** | A failed OTP send stops reporting success ([otp.controller.ts](../apps/api/src/auth/otp/otp.controller.ts)) |
| **W1.6** | The UI acts on it: honest copy + an unconditional "continue with email" affordance ([PhoneLoginFlow.tsx](../apps/web/src/components/auth/PhoneLoginFlow.tsx)) |
| **W2** | The delivery-status webhook ([whatsapp-webhook.service.ts](../apps/api/src/notifications/webhooks/whatsapp-webhook.service.ts)) |

**No database migration ships with CR-WA.** `whatsapp_messages` has existed since S2
with a `status` column that nothing could advance past `SENT`, because there was no
receiver for the provider's callbacks. W2 is what finally closes that.

---

## Configuration — which variable goes on which platform

The deploy topology is three separate hosts, and **the WhatsApp variables are not
uniform across them**. This table is the whole answer:

| Variable | API (Render) | Worker (Railway) | Web (Vercel) | Notes |
| --- | :---: | :---: | :---: | --- |
| `WHATSAPP_PROVIDER` | ✅ | ✅ | — | `meta` to go live; `mock` is the default AND the rollback |
| `WHATSAPP_ACCESS_TOKEN` | ✅ | ✅ | — | System-user token (see below) |
| `WHATSAPP_PHONE_NUMBER_ID` | ✅ | ✅ | — | The **phone number ID**, not the phone number |
| `WHATSAPP_GRAPH_VERSION` | ✅ | ✅ | — | Defaults to `v21.0`; pinned deliberately |
| `WHATSAPP_TIMEOUT_MS` | ✅ | ✅ | — | Defaults to `10000`. On the API this bounds a **login request** |
| `WHATSAPP_TEMPLATE_LANGUAGE` | ✅ | ✅ | — | Defaults to `en_US`. ⚠️ Must match the locale your templates are **approved in** — see below |
| `WHATSAPP_VERIFY_TOKEN` | ✅ | ❌ | — | **API only** — Meta calls the API back |
| `WHATSAPP_APP_SECRET` | ✅ | ❌ | — | **API only** |

**The web app needs none of these.** `apps/web` is HTTP-only and never talks to Meta.

### Why the send credentials go on BOTH services

The worker owns notification sends; the API sends login OTPs **inline** — the
documented exception in
[worker-and-external-sends.md](../.claude/rules/worker-and-external-sends.md),
because a user is waiting at the login screen.

> ⚠️ **Setting them on only one service is the failure mode to fear.** With `meta`
> on the worker but not the API, notifications send for real while every login OTP
> silently goes to the mock — no error, no log, no message. The reverse leaves
> "you have been selected" undelivered. There is no alert for this; the only
> symptom is absence. Both services, or neither.

### Why the webhook credentials go on the API only

Meta calls **us**, at the API's public URL. The worker has no HTTP server
(`main.worker.ts` runs BullMQ + cron only), so these variables would be inert there.

---

## Meta dashboard setup

Do these in order. Steps 1–4 are prerequisites for the webhook in step 5.

- [ ] **1. App + WhatsApp product.** In [developers.facebook.com](https://developers.facebook.com),
      create (or open) the Business app and add the **WhatsApp** product.
- [ ] **2. Business phone number.** Register the sending number under the WABA.
      Copy its **Phone number ID** (a numeric id) → `WHATSAPP_PHONE_NUMBER_ID`.
      The ID is what the API uses; the human-readable number is not interchangeable.
- [ ] **3. Access token.** Generate a **System User token** (Business Settings →
      System Users), not the 24-hour tester token from the Getting Started panel.
      Scopes: `whatsapp_business_messaging`, `whatsapp_business_management`.
      → `WHATSAPP_ACCESS_TOKEN`.
      A temporary token will work in the smoke test and then expire mid-week, which
      presents as WhatsApp silently stopping.
- [ ] **4. App Secret.** App Settings → Basic → App Secret → `WHATSAPP_APP_SECRET`.
- [ ] **5. Templates.** Confirm all three below are **APPROVED** in WhatsApp Manager,
      in **English**, with the exact names in the table.
- [ ] **6. Webhook.** See [The webhook](#the-webhook) — do this **after** the API is
      deployed with `WHATSAPP_VERIFY_TOKEN` set, and **warm** (see the warning there).

---

## The three templates

Names are mapped in
[meta-templates.ts](../apps/api/src/notifications/channels/meta-templates.ts) and
**validated at startup** — a whatsapp-tier notification type with no mapped template
crashes the process at boot rather than failing sends silently for months.

| Meta template name | Logical key | Body params | Header | Sent when |
| --- | --- | :---: | --- | --- |
| `login_otp` | *(none — `sendOtp`)* | 1 | — | `POST /auth/otp/send` (signup verify) and `POST /auth/login/phone/start` (login) |
| `job_selected` | `wa.selected` | 3 | — | `APPLICATION_SELECTED` |
| `resume_generated` | `wa.resume_doc` | 1 | **document** | `RESUME_SENT` |

### `job_selected` — the positional order IS the contract

```
{{1}} candidate name   {{2}} job title   {{3}} company
```

Meta's parameters are positional, so a swapped pair produces a message that reads
perfectly and says something false — *"selected for Gulf Wiring LLC at Senior
Electrician"*. It cannot be unsent. The order is defined once, in
[selected-template-vars.ts](../apps/api/src/applications/selected-template-vars.ts),
because two senders use it (the employer transition and the admin resend).

If any parameter is unresolvable the notification **omits them and fails the WhatsApp
honestly**, falling back to email — better than sending "You have been selected for
&nbsp;at&nbsp;".

### `login_otp` — one template, two flows

`PHONE_VERIFY` (signup) and `LOGIN` both use it. **Its copy must read correctly for
both** — "your verification code", not "log in". Check the approved copy before go-live.

It is also an **Authentication** template, which Meta requires to carry a **URL button
component** with the code repeated as the button parameter; the adapter sends it.
A body-only auth send is rejected.

### `resume_generated` — the document header

The PDF is **uploaded as bytes** to `/media` first (a second network call with its own
failure path), then referenced by media id. It is not sent as a URL: every document URL
this platform mints is a short-expiry signed R2 URL and would routinely be dead by the
time Meta fetched it.

### ⚠️ The locale is part of a template's IDENTITY — `en` ≠ `en_US`

**This is the single most likely thing to break your first send.** Meta treats
each locale as a **different template**. Requesting a name in a locale it was not
approved in fails with:

```
404  code=132001  "(#132001) Template name does not exist in the translation"
     details=template name (login_otp) does not exist in en
```

which reads like the template was never created. It was — it is just registered
under another locale. WhatsApp Manager offers both **English** (`en`) and
**English (US)** (`en_US`), and a template created without deliberately changing
the dropdown lands on `en_US`.

Read the locale off the template in WhatsApp Manager and set
`WHATSAPP_TEMPLATE_LANGUAGE` to match — **the same value on both services**. It
is an env var rather than a constant precisely so this is a restart, not a
redeploy, on the day you are trying to go live. A single template approved in a
different locale from the others can override it per-entry via `language` in
[meta-templates.ts](../apps/api/src/notifications/channels/meta-templates.ts).

English-only is the current product decision; this is about *which* English.

---

## The webhook

```
GET  <API_ORIGIN>/api/v1/webhooks/whatsapp   ← subscription handshake
POST <API_ORIGIN>/api/v1/webhooks/whatsapp   ← delivery statuses
```

`API_ORIGIN` — confirm before pasting: `________________________________`
*(at the time of writing the API is the Render service `skillindiaconnect-api`)*

In the Meta dashboard: **WhatsApp → Configuration → Webhook**, paste the URL, paste
the same string you set as `WHATSAPP_VERIFY_TOKEN`, then **subscribe to the `messages`
field** — delivery statuses arrive under that subscription. Without the subscription
the handshake succeeds and no callbacks ever arrive, which looks like a broken handler.

> ⚠️ **WARM THE API BEFORE CLICKING VERIFY.** Meta's verification GET has a short
> timeout. A Render service that has spun down will cold-start, miss it, and report a
> generic failure that reads exactly like a wrong URL or a wrong token — sending you
> to debug the two things that are actually correct. Load any API URL in a browser
> first, confirm it responds, then click Verify.

Other things that present as "wrong token":

- The response body must be the challenge **verbatim** — bare text, not JSON, not
  wrapped in this API's `{ data }` envelope. The handler already does this; the point
  is that a well-meaning refactor toward envelope consistency would break verification.
- `WHATSAPP_VERIFY_TOKEN` must match **exactly**. A trailing newline pasted into
  either side is invisible and fatal.

### Security posture

The endpoint is **public and unauthenticated — the HMAC is the only defence.**
`X-Hub-Signature-256` is verified over the raw bytes, constant-time, **before**
`JSON.parse` is reached. A **missing `WHATSAPP_APP_SECRET` rejects everything**; it
never means "accept unsigned".

### Statuses are ranked, not overwritten

`QUEUED(0) → SENT(1) → DELIVERED(2) → READ(3) → BOUNCED(4) → FAILED(5)`

Meta does not guarantee ordering and retries aggressively, so a `sent` can legitimately
arrive after a `delivered`. Updates apply only over strictly-lower ranks, so a late
callback can never make a row claim **less** than we already know. `FAILED` is terminal.

`statusUpdatedAt` is **our** clock — when we *learned*, not Meta's send timestamp.

---

## Live smoke test — fill these in

**Not part of the automated suite.** Nothing below has been run: the envelope shape,
the `sha256=` header format, the handshake parameters and the error codes are written
from Meta's documented contract and are **unproven against the live service**. This
section exists to settle that.

Run with `WHATSAPP_PROVIDER=meta` on **both** services, against a WhatsApp number you
control.

**Date run:** `____________`  **Run by:** `____________`  **Graph version:** `____________`

### Pre-flight

- [ ] Both services show `meta` (a boot with missing credentials **crashes** — a clean
      boot is itself evidence the credentials are present and the template mapping is complete)
- [ ] Webhook verified in the Meta dashboard, `messages` field subscribed
- [ ] Test number is not in a Meta-imposed 24h window restriction that would block sends

### Sends

| # | Flow | Trigger | Message arrives | Copy correct | `whatsapp_messages` row |
| --- | --- | --- | :---: | :---: | --- |
| 1 | OTP — signup | `POST /auth/otp/send` from the onboarding phone widget | ☐ | ☐ | status: `______` |
| 2 | OTP — login | Phone tab on `/login` with a registered number | ☐ | ☐ | status: `______` |
| 3 | Selected | Move an application to SELECTED as the employer | ☐ | ☐ | status: `______` |
| 4 | Resume | Trigger `RESUME_SENT` | ☐ | ☐ | status: `______` |

- [ ] **#3 reads correctly** — name, then job title, then company, in that order.
      A swapped pair is the failure this row exists to catch: `____________________`
- [ ] **#4 arrives as an openable PDF attachment** with the right filename: `____________`

### The webhook — the part that proves W2

Watch one message's row advance **without any redeploy**:

```sql
SELECT "kind", "templateName", "status", "statusUpdatedAt", "errorCode", "waMessageId"
FROM whatsapp_messages
ORDER BY "createdAt" DESC
LIMIT 20;
```

- [ ] A row reaches `DELIVERED` on its own: `________________________________`
- [ ] Opening the message on the handset advances it to `READ`: `________________`
- [ ] `waMessageId` is populated (a `wamid.` value). **If it is NULL, statuses can never
      join** and every callback is a silent no-op — check this first if nothing advances.
- [ ] Re-sending the same callback changes nothing (idempotent): `________________`

### Failure paths

| Case | How to force it | Expected | Observed |
| --- | --- | --- | --- |
| Not on WhatsApp | Send to a number with no WhatsApp | Row `FAILED`; signup UI says "not on WhatsApp" | `__________` |
| Provider outage | Temporarily invalidate the token | `POST /auth/otp/send` → **503 `OTP_SEND_FAILED`**, UI says "couldn't send… try again", **never "code sent"** | `__________` |
| Bad signature | `curl` the webhook with a wrong `X-Hub-Signature-256` | **401**, nothing written | `__________` |

- [ ] No PII in logs — recipient appears **hashed**, never as a phone number, and no
      OTP code appears anywhere: `________________________________`

---

## Rollback

**Instant, no deploy:** set `WHATSAPP_PROVIDER=mock` on **both** services and restart.
Sends stop leaving the system; flows keep running against the mock (recorded, not sent).

No schema or data changes ship with CR-WA, so there is nothing to migrate back.

**Leave the webhook configured.** Callbacks for messages sent *before* the rollback
still carry real `wamid.` ids and will keep correctly advancing those rows — the
delivery record stays accurate for what actually went out. New rows written under
`mock` get a `mock-<uuid>` id that no Meta callback can match, so they simply never
advance, which is the truthful outcome for a message that was never sent.

**Partial rollback is a trap:** flipping one service to `mock` recreates exactly the
half-configured state described above.

---

## Known gaps

Tracked as accepted limitations in [known-deferrals.md](./known-deferrals.md).

- **There is no email-OTP fallback.** WhatsApp is the only OTP transport: the matrix
  has no OTP entry and `OtpService` calls exactly one channel. A Meta outage therefore
  removes phone login entirely. *(A stale "OTP-via-email fallback" row in
  [cutover-titan-email.md](./cutover-titan-email.md) claimed otherwise; corrected
  2026-08-06.)*
- **W1.6's "Continue with email instead" does not open for a Google-only account.**
  `users.passwordHash` is nullable, so a candidate who signed up with Google and
  verified their phone during onboarding has no password. The affordance switches them
  to the email+password tab, which they cannot use; `POST /auth/forgot-password`
  correctly refuses to issue a token and emails "this account uses Google sign-in"
  instead. Their working route is the **Continue with Google** button, which is
  rendered above the tabs on the same screen — so it is a mislabelled affordance
  rather than a dead end, but it points the wrong way for exactly the users least
  likely to have a password.
- **Phone-login failures are invisible to the user by design.**
  `/auth/login/phone/start` always returns the same body: a send is only *attempted*
  for a registered number, so an honest error would make the endpoint an
  account-existence oracle. Honesty lives in the delivery ledger and the logs instead.
- **Inbound messages are ignored.** A candidate replying to a template gets no
  response and no record. `messages[]` payloads are answered 200 and dropped;
  conversational handling is out of scope at MVP.
- **No alerting on a rising `FAILED` rate.** The data is in `whatsapp_messages`;
  nothing watches it. Until something does, the query above is the monitoring.
