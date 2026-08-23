# Known deferrals — accepted limitations at handoff

**What this is:** work that is deliberately NOT done, with the consequence stated
plainly. Read it before an incident, not during one.

Everything here is a decision, not an oversight. Each entry says what is missing,
**who it affects**, what the workaround is, and what would close it. If you are
on call and something in here is biting, the runbook section is linked.

> Entries are removed only when the work actually ships — not when it is
> scheduled.

---

## CR-OTP — WhatsApp is the only OTP transport

**Status: deferred to post-launch. Accepted 2026-08-06.**

`OtpService` calls exactly one channel (`WhatsappChannel.sendOtp`). The
notification matrix has **no OTP entry**, and nothing anywhere sends a code by
email or SMS.

### The consequence

**A Meta outage prevents phone login.** It is a login-availability incident, not
a degraded notification channel.

| User | Route in during a WhatsApp outage |
|---|---|
| Signed up with email + password | Email tab — unaffected |
| Signed up with Google | **Continue with Google** — unaffected |
| Signed up by phone, no password set | **Blocked** until WhatsApp recovers |

The sign-in screen offers **"Use another sign-in method"** unconditionally on
both phone-login steps, which switches to the email panel with the Google button
visible above it. The copy is deliberately method-neutral: `users.passwordHash`
is nullable, so naming "email" would point Google-signup candidates at a form
they cannot use.

Note the affordance cannot be conditional on the failure. `/auth/login/phone/start`
returns an identical response whether or not the number is registered — a send is
only *attempted* for a registered number, so a failure-triggered UI would leak
account existence. That is why the escape hatch is shown to everyone, always.

### Detection

`WhatsappOtpSendFailures` (critical, pages) fires on a >10% OTP failure ratio over
10m. Runbook: [WhatsApp send failures](./runbook.md#whatsapp).

### What would close it

An `OtpTransport` port with `whatsapp` and `email` implementations, an
`OTP_LOGIN` notification type, and a fallthrough in `OtpService.issue` on
`ok:false`. Estimated ~1.5–2 days, and **most of that is not the transport**:

- **The enumeration review is the real work.** Falling back to email on
  `/auth/login/phone/start` makes behaviour vary with whether an account exists —
  the exact property that endpoint protects. It likely has to attempt both for a
  registered number and keep the response constant, eating a wasted send.
- **The API sends OTPs inline** (the documented exception in
  `worker-and-external-sends.md`). Adding an email send on the failure path puts
  a *second* blocking network call on the login request; it needs its own timeout
  budget or a slow Meta plus a slow Resend becomes a 20-second login.

Deferred because rushing the enumeration review is how you trade a rare outage
for a permanent account-existence oracle.

---

## CR-WA — inbound WhatsApp messages are ignored

**Status: deferred, no date.**

The delivery webhook answers `messages[]` payloads with 200 and drops them. A
candidate who replies to a template gets **no response and no record** — nobody
is notified that they wrote in.

**Workaround:** none. Templates should not invite a reply.

**What would close it:** inbound handling belongs on the queue rather than inline
in the webhook (unlike status updates, which are cheap DB writes). This is
genuinely new product surface — conversation state, routing to a human,
Meta's 24-hour customer-service window — not a small addition.

---

## Nothing verifies the WhatsApp integration against Meta until the smoke test

**Status: open until the go-live smoke test is run.**

The envelope shape, the `sha256=` signature format, the handshake parameters and
the Meta error codes are written from Meta's documented contract and are
**unproven against the live service**. The automated suite proves our behaviour
given those shapes; it cannot prove the shapes are right.

**What would close it:** the blank runbook in
[whatsapp-integration.md](./whatsapp-integration.md#live-smoke-test--fill-these-in).
Fill it in with real results — a fabricated tick there is worse than an empty one.

---

## CR-NULLEMAIL — the phone-signup release cannot be rolled back through

**Status: accepted 2026-08-24, at the merge of phone signup.**

`20260823120000_phone_signup_email_otp` widens `users.email` and
`otp_challenges.phone` from NOT NULL to NULL. Widening is the safe direction and
the migration is expand-only, so **deploying forward is safe**: the release
command applies migrations before new containers take traffic, and no NULL-email
row can exist until the new code is the code creating accounts.

Rolling **back** is the direction that does not work.

### The consequence

Prisma's query engine does not hand a `null` to a field its client types as
non-nullable — it throws:

```
Error converting field "email" of expected non-nullable type "String",
found incompatible value of "null".
```

So once a single candidate has signed up by phone, reverting to the release
**before** this one breaks every query that returns that user's whole row —
`phoneLoginVerify`'s `findUniqueOrThrow` among them. The old client cannot even
route around it: `NOT: { email: null }` is rejected by its own generated types.

| Rollback hop | Safe? |
|---|---|
| this release → the one before it, **before** any phone signup | Yes — no NULL rows exist |
| this release → the one before it, **after** a phone signup | **No** — user queries throw |
| any later release → this one | Yes — this client types email nullable |

Verified empirically, not reasoned about: the previous release's Prisma client
was generated against the migrated database and run. Narrow-`select` queries,
`count()`, and `findUnique` by a real address all pass; anything selecting
`email` across a NULL row throws. The three `user.findMany` sites in the API all
use narrow selects that exclude `email`, so the background workers are unaffected.

### Detection

Not a monitored condition — it can only occur during a deliberate rollback. If a
rollback is in progress and the API starts 500ing on login and admin user lists
with the conversion error above, this is why.

**Recover by rolling FORWARD**, not further back.

### What would close it

Shipping the migration and the phone-signup code as two separate releases: the
first carrying the migration plus a client that tolerates NULL but with signup
disabled, the second enabling it. That keeps every hop reversible. It was not
done because the extra release cycle and feature flag buy little while the
product is pre-launch — the odds of needing to roll back *through this specific
boundary* are low, and the failure is loud and immediate rather than silent.

Once a rollback through this boundary would matter, the cheaper close is simply
never to go back that far: any release from this one onward is a safe target.
