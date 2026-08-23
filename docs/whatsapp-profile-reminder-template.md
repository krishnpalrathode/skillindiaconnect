# WhatsApp template — `profile_completion_reminder`

The one-time "finish your profile" nudge, sent 24 hours after a candidate
registers if they are still below the apply threshold.

Everything in this document is **copy-paste ready for WhatsApp Manager**. Submit
it exactly as written — the parameter count and order are asserted in code
(`meta-templates.ts`, `params: 3`), and Meta's mismatch error (132000) is opaque
enough that a silent edit here costs an afternoon to diagnose.

---

## 1. Template settings

Paste these into **WhatsApp Manager → Message Templates → Create template**.

| Field | Value |
| --- | --- |
| **Name** | `profile_completion_reminder` |
| **Category** | **Utility** |
| **Language** | **English (US)** — `en_US` |
| **Header** | None |
| **Footer** | `Skill India Connect` |
| **Buttons** | One **Visit website** button (static URL) |

### Why Utility and not Marketing

This message continues an action the candidate started themselves minutes
earlier — it tells them the state of their own account and what is needed to
finish it. That is Meta's definition of a utility template, and utility pricing
is materially cheaper per conversation.

**If Meta rejects it as Marketing**, do not argue and do not soften the copy —
resubmit the identical body under the Marketing category. The code does not care
which category approved it. What the code cares about is the **name**, the
**language**, and the **three parameters**, all of which stay the same.

### Why `en_US` and not `en`

They are **different templates** to Meta. Asking for a name in a language it was
not approved in fails with `132001 — template name does not exist in en`, which
reads like the template is missing entirely. WhatsApp Manager creates templates
as `en_US` unless you deliberately pick plain "English", and this repo's
`WHATSAPP_TEMPLATE_LANGUAGE` defaults to `en_US` to match. If you approve it
under a different language, change that env var — it exists so this is a restart
rather than a redeploy.

---

## 2. Body — paste exactly

```
Hi {{1}}, welcome to Skill India Connect.

Your profile is {{2}}% complete. Employers need at least {{3}}% before you can apply, so a few more details is all that stands between you and your first application.

Add your remaining information — your work experience, skills and documents — and start applying for verified jobs in India and the Gulf.
```

### Footer — paste exactly

```
Skill India Connect
```

### Button

| Field | Value |
| --- | --- |
| Type | **Visit website** |
| URL type | **Static** |
| Button text | `Complete my profile` |
| URL | `https://skillindiaconnect-web.vercel.app/en/profile` |

> **The URL must be static, not dynamic.** The sending code
> (`meta-whatsapp.channel.ts`) builds only header and body components — it sends
> no button parameters. A dynamic URL button would require a `button` component
> at send time, and without it Meta rejects the call. Replace the host with your
> production domain before submitting.

---

## 3. Sample values

Meta requires an example for every variable before it will accept the template.

| Variable | Example | What the code sends |
| --- | --- | --- |
| `{{1}}` | `Ramesh` | Candidate's **first name** only |
| `{{2}}` | `40` | Current completion %, no `%` sign — the sign is in the copy |
| `{{3}}` | `70` | Required %, read live from `candidates.min_completion_pct` |

Rendered, the sample reads:

> Hi Ramesh, welcome to Skill India Connect.
>
> Your profile is 40% complete. Employers need at least 70% before you can
> apply, so a few more details is all that stands between you and your first
> application.
>
> Add your remaining information — your work experience, skills and documents —
> and start applying for verified jobs in India and the Gulf.
>
> _Skill India Connect_
>
> **[ Complete my profile ]**

---

## 4. Why the copy is written this way

- **The percentages are variables, not text.** `{{3}}` is the
  `candidates.min_completion_pct` setting. Writing "70%" into the approved body
  would silently become a lie the day an admin changes that setting — in a
  message that cannot be edited or recalled once delivered.
- **`{{2}}` carries no `%` sign.** The sign lives in the template so the
  variable is a bare number. Meta rejects parameters containing newlines, tabs
  or more than four consecutive spaces; keeping variables to plain digits and a
  name avoids that class of rejection entirely.
- **First name only.** "Hi Ramesh" reads like a person wrote it. "Hi Ramesh
  Kumar Singh" reads like a mail merge, which is exactly what a nudge cannot
  afford to look like.
- **It states the barrier, then removes it.** The candidate is told the specific
  number they need and what to add. A generic "complete your profile" gives them
  no way to judge how far off they are.
- **No urgency, no scarcity, no emoji.** This audience is often reading in a
  second language, and pressure tactics read as a scam. Plain sentences survive
  translation and build trust.
- **It never promises a job.** "Start applying" is what actually becomes
  possible. Anything stronger would be a claim the platform cannot honour.

---

## 5. After approval

1. Confirm the name and language are live:
   ```
   pnpm whatsapp:templates
   ```
   The template must appear as `profile_completion_reminder` with status
   `APPROVED` in the language you set in `WHATSAPP_TEMPLATE_LANGUAGE`.
2. Nothing else to deploy — `wa.profile_reminder` is already mapped in
   `meta-templates.ts` and `PROFILE_REMINDER` already has `whatsapp: true` in
   the notification matrix.

**Until it is approved, sends fail with `132001` and fall back to email.** The
candidate is still reached; they just hear by the slower route. That fallback is
the existing matrix behaviour, not something this feature adds — so shipping the
code before approval is safe.

---

## 6. Behaviour, for whoever reviews this

| Question | Answer |
| --- | --- |
| When is it sent? | 24–25 hours after the candidate's profile is created |
| How often? | **Once, ever** — guarded by a `NOT EXISTS` against their `PROFILE_REMINDER` feed row |
| Who is excluded? | Anyone at or above the threshold; suspended, pending-deletion and purged accounts; anyone already nudged |
| Who registered long ago? | Only profiles created in the last 7 days are scanned — see `PROFILE_NUDGE_MAX_AGE_DAYS`. Candidates who registered before this shipped are deliberately **not** back-filled |
| No verified phone? | Falls back to email automatically (`whatsappCapable = false`) |
| Where does it run? | Worker process, hourly cron at minute 15 → BullMQ `profile-nudge` queue |
