# PWA + Play Store (TWA)

Making the **existing** web app installable. Same codebase, same deployment, same API —
a deploy to the web is live in the installed app with no store release.

| Unit | Status |
| --- | --- |
| 1 — Manifest + icons | **Done** |
| 2 — Service worker + install prompt | **Done** |
| 3 — TWA / Play Store packaging | **Done** — runbook ready, see checklist below |

---

## Before launch — the human checklist

Units 1–3 are shipped in code. Everything below needs a person, and the first three are
ordered because each one blocks the next.

**1. Get the web origin** — ✅ **DONE**
`https://skillindiaconnect-web.vercel.app` — **Vercel**, platform default, not a custom
domain. (An earlier reading of `render.yaml` concluded Render; that was wrong. The live site
answers on Vercel.)

Units 1–3 are deployed to it and verified in production:

| Path | Status | Content-Type |
| --- | --- | --- |
| `/en/manifest.webmanifest` | 200 | `application/manifest+json` |
| `/ar/manifest.webmanifest` | 200 | `dir: rtl`, localized name |
| `/icons/*` (all four) | 200 | `image/png` |
| `/sw.js` | 200 | `Cache-Control: no-cache, must-revalidate` |
| `/.well-known/assetlinks.json` | 200 | `application/json` |

> ⚠️ The assetlinks fingerprint currently holds the **TEST key** (see the test-APK section
> below), not a Play one. It verifies — Google's statements API confirms it — but it must be
> replaced before anything reaches Play.

**2. Decide the custom domain — now, not after launch** *(blocks TWA generation)*
If a production domain (`skillindiaconnect.com` or similar) is intended at all, **attach it
first and build the wrapper against it.** Doing it now costs a day. Doing it after launch
costs moving `assetlinks.json`, regenerating the TWA, a Play re-review, and every existing
install pointing at the old origin until the user updates.

> Custom domain planned? ☐ no — build against the Render default
> ☐ yes → `___________________________` — attach it before step 4

**3. Send the privacy gaps to legal** *(runs in parallel; blocks the data-safety form)*
All three in one pass: **video, photo, nationality.** Ask them to treat the 500 MB / 5-minute
video as its own category rather than folding it into profile data — see the brief in
*Privacy policy — gap review* below.

> ☐ sent  ☐ policy updated  ☐ data-safety form matches the updated policy

**4. Generate the TWA and wire Asset Links** *(needs 1 and 2)*
Follow *TWA generation runbook*. Then take the fingerprint from
**Play Console → Setup → App Integrity → App signing key certificate → SHA-256** —
not the *Upload key certificate* directly beneath it — put it in
`apps/web/public/.well-known/assetlinks.json`, and **deploy the web app before installing the
build**.

> Package name = `___________________________`
> Upload-key custodian = `___________________________`

**4b. Throwaway test APK — ✅ BUILT** *(sideload only, never Play)*
`~/Downloads/skillindiaconnect-TEST-ONLY.apk`. Signed with a disposable key, Asset Links
verified by Google. Full procedure and the four Windows traps: *The throwaway test APK*, below.

**5. The acceptance test — on a real cheap Android phone, not an emulator**
Install the release build and confirm:

> ☐ installs and opens **fullscreen with no address bar** ← if this fails, it is almost
>   certainly the fingerprint: the app signing certificate, not the upload key
> ☐ icon and splash render correctly
> ☐ usable on a throttled connection
> ☐ sign in, close the app fully, reopen → still signed in (via `/auth/refresh`)
> ☐ Arabic renders right-to-left inside the installed shell

---

## Unit 1 — manifest + icons

Static assets and one route handler. **No service worker, no runtime code, no install
prompt.** Nothing about an existing request changed.

### What shipped

| File | Purpose |
| --- | --- |
| `apps/web/src/app/[locale]/manifest.webmanifest/route.ts` | The manifest, one per locale |
| `apps/web/public/icons/*.png` | 4 icons — 192/512, `any` + `maskable` |
| `apps/web/scripts/generate-pwa-icons.mjs` | Regenerates the icons from brand art |
| `apps/web/src/app/[locale]/layout.tsx` | Links the manifest via Next metadata |
| `apps/web/src/i18n/messages/en.json` | One new key: `pwa.shortName` |

### The manifest is per-locale, and that is the whole design

`name`, `short_name`, `description`, `lang` and `dir` are **single-valued** in a manifest.
This app ships **22 languages**, four of them RTL (`ur`, `fa`, `ps`, `ar`), and the brand
itself is translated. One global manifest would put an English label under every home-screen
icon and declare `dir: ltr` for the RTL languages.

So `/{locale}/manifest.webmanifest` is served per locale and linked from that locale's layout.
Verified output:

| Locale | `lang` | `dir` | `name` | `start_url` |
| --- | --- | --- | --- | --- |
| en | `en` | `ltr` | Skill India Connect | `/en` |
| hi | `hi` | `ltr` | स्किल इंडिया कनेक्ट | `/hi` |
| ar | `ar` | **`rtl`** | سكيل إنديا كونكت | `/ar` |
| ur | `ur` | **`rtl`** | اسکل انڈیا کنیکٹ | `/ur` |

### `start_url` — pinned to the install-time locale

**Decision:** `start_url: "/{locale}"`.

The alternative was a locale-neutral `/` with middleware re-negotiating on each launch.
**Rejected:** middleware negotiates from the browser's `Accept-Language`, not from the
language the user chose *inside the app*. Someone on an English-set phone who picked Hindi
would get English on every cold start — the one moment they cannot easily correct it,
because the launcher gives them no address bar.

**Trade-off, stated plainly:** the installed shortcut is pinned to whatever locale they were
browsing when they installed. Changing language in-app does not rewrite an existing
shortcut. They switch after launch, as they do today. *Confirm on a real device in Unit 3.*

### `scope` and `id`

- **`scope: "/"`** — the whole origin, deliberately not `/{locale}`. A scope of `/hi` would
  treat switching to Arabic as an *external* navigation and eject the user into a browser
  tab mid-session.
- **`id: "/"`** — fixed and identical across locales. Without it Chrome derives app identity
  from `start_url`, so each locale would be a separate installable app and a user could
  collect three Skill India Connect icons.

### `lang` / `dir` and the RTL guarantee

The manifest carries the locale's own `lang`/`dir`. It does **not** and cannot override the
document — `<html lang dir>` is still set by `apps/web/src/app/layout.tsx` from
`getDir(locale)`, which reads the `dir` field on the locale registry. The manifest is
metadata for the launcher; the page's direction remains the layout's job.

### Colours — from existing tokens, no new palette

| Manifest field | Token | Value |
| --- | --- | --- |
| `theme_color` | `--color-primary-700` ("brand anchor") | `#1a3c6e` |
| `background_color` | `--background` | `#ffffff` |

`background_color` paints the splash **before the first frame renders**, so it must match
the app's real page ground or the launch flashes.

### Icons — 4 files, not the legacy 8

| File | Size | Purpose |
| --- | --- | --- |
| `icon-192.png` | 192×192 | `any` — transparent |
| `icon-512.png` | 512×512 | `any` — transparent |
| `icon-maskable-192.png` | 192×192 | `maskable` |
| `icon-maskable-512.png` | 512×512 | `maskable` |

**Why only two sizes.** Chrome's install criteria need 192 and 512; Android derives every
other density from them. The 48/72/96/128/144/384 ladder is pre-adaptive-icon advice — it
would put six more files in the repo for the platform to ignore.

**Maskable treatment.** The mark is scaled to **72%** of the canvas, centred, on an **opaque
white** ground.

- *Why 72%:* the maskable spec guarantees only a centred circle of 80% diameter survives.
  The brand mark is a disc with a star breaking out of its top-right — that star is the part
  at risk. 72% keeps it inside the guaranteed circle. **Verified by rendering the icon under
  a circle mask, not by arithmetic** — the mark survives with clean margin on all sides.
- *Why white, not brand navy:* the mark's disc is `#3b4554`. Navy-on-navy would read as a
  dark smudge. `SIC_favicon_2.png` already sets the mark on white, so this follows the
  existing brand treatment rather than inventing one.

**Regenerating.** `apps/web/scripts/generate-pwa-icons.mjs`. `sharp` is deliberately **not**
a repo dependency — a native image library in the Docker build for a once-a-year task is a
poor trade. Install it in a scratch directory:

```
mkdir /tmp/icongen && cd /tmp/icongen && npm init -y && npm i sharp
cd <repo> && node apps/web/scripts/generate-pwa-icons.mjs
```

The **output is committed**, so a normal checkout and a normal build never need `sharp`.

### Known gap

`pwa.shortName` exists only in `en.json`, so every non-English locale falls back to
"Skill India" under the icon while `name` is correctly translated. This matches how every
other key in this repo behaves (locales merge over English) and is a translator task, not a
code one.

## Unit 2 — service worker + install prompt

**No dependency added.** A hand-rolled worker (`apps/web/public/sw.js`, ~150 lines including
the reasoning) beat `@serwist/next` here for one reason: Next already content-hashes
`/_next/static/*`, so a deploy produces new filenames and cache-first on them is
self-invalidating. That removes the main thing a library buys — precache-manifest generation
and revisioning — and leaves the caching rules readable in one screen. When the failure mode
is a privacy breach, auditable beats featureful.

### What shipped

| File | Purpose |
| --- | --- |
| `apps/web/public/sw.js` | The worker |
| `apps/web/public/offline.html` | Offline fallback, precached |
| `src/components/pwa/ServiceWorkerRegistrar.tsx` | Registration, gated on MSW |
| `src/components/pwa/InstallPrompt.tsx` | Dismissible install banner |
| `apps/web/next.config.mjs` | `no-cache` on `sw.js` + `offline.html` |
| `tests/pwa/` + `playwright.pwa.config.ts` | The privacy proof (`pnpm test:pwa`) |

### The caching rule as shipped — allowlist, and non-interception

Two properties, not one:

1. **Allowlist.** Nothing is cached unless it positively matches a prefix. A denylist fails
   open the day someone adds an endpoint; an allowlist fails closed.
2. **Non-interception.** For anything outside the allowlist the worker returns *without*
   calling `event.respondWith()`, so the browser handles it natively. The API is not
   "excluded from caching" — **it never enters the worker's code path at all**.

The allowlist is same-origin `GET` under: `/_next/static/`, `/icons/`, `/brand/`, `/hero/`,
`/flags/`, `/resume-templates/`. Explicitly never: `/mockServiceWorker.js`, `/sw.js`.

> `/resume-templates/` holds template **preview thumbnails**, not user resumes. A generated
> resume is a short-expiry signed R2 URL on a different origin and cannot match this list.

The API and R2 are **different origins** in production, so the same-origin check alone
already rejects every API call, signed document URL and resume PDF. The path allowlist is a
second, independent gate on top of that.

**HTML is never cached.** Every page fetches its data client-side with an in-memory token,
so server-rendered HTML carries no user data *today* — but caching it would mean that the day
someone server-renders something personal, it silently starts leaking. Network-only for
navigations also means there is no stale-shell class of bug to reason about.

### Update strategy — silent, on next navigation

HTML is network-only, so a navigation always fetches fresh HTML, which references the new
hashed asset URLs. **There is nothing to invalidate and nothing to prompt about.** The user
is never shown an "update available" bar.

That is a deliberate choice for this audience: an update banner competing for attention on a
cheap phone, on a slow connection, while someone is reading a job posting, is worse than a
swap they never notice. `skipWaiting()` + `clients.claim()` means a new worker takes over
immediately rather than waiting for every tab to close.

### Kill switch

A service worker is sticky — once installed it persists across deploys and can keep serving
itself. `sw.js` is served with `Cache-Control: no-cache, must-revalidate` (set in
`next.config.mjs`) specifically so the browser re-fetches it and a replacement propagates.

**To disable the worker in production**, replace the entire contents of
`apps/web/public/sw.js` with this and deploy:

```js
// KILL SWITCH — unregisters the worker and drops every cache.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    })(),
  );
});
```

Clients pick it up on their next navigation. **The web app itself is unaffected either way** —
without a worker it is simply slower on repeat visits.

### MSW coexistence

MSW registers its own worker at `/mockServiceWorker.js`, scope `/`. Two workers competing for
one scope is a real dev-time failure: whichever registers last wins, so API mocking or the
shell cache silently stops working depending on a race.

Resolution: **the PWA worker does not register when `NEXT_PUBLIC_API_MOCKING === 'enabled'`.**
Mock mode is a development tool, the shell cache is a production concern, and nothing needs
both. `public/mockServiceWorker.js` was not touched.

This is also why the PWA tests need their own Playwright config — the main UI suite forces
MSW on, which would make every assertion here vacuous.

### The privacy proof — actual output

`pnpm test:pwa` (4 tests, all passing). Run against a real signed-in session on the real API:

```
signed in → /en/dashboard

API calls made during the session: 34
  /api/v1/auth/refresh
  /api/v1/candidates/me
  /api/v1/candidates/me/completion
  /api/v1/candidates/me/notifications?unread=true&pageSize=50
  /api/v1/candidates/me/profile-views
  /api/v1/candidates/me/stats
  /api/v1/jobs?pageSize=4
  /api/v1/candidates/me/video

CACHE CONTENTS — 23 entries
   22 x /_next/static/...
    1 x /offline.html

AUTHENTICATED ENTRIES IN CACHE: 0
```

34 authenticated calls, including the profile and video endpoints. Nothing from any of them
reached the cache.

The suite asserts both directions: no forbidden substring appears in any cache entry, **and**
every entry that *is* cached is same-origin and under an allowlisted prefix — so a future
change that starts caching something new fails the test rather than passing quietly.

### Auth across a cold start — observed

A new page in the same browser profile (the in-memory token gone, the httpOnly refresh cookie
intact) is what relaunching an installed PWA looks like:

```
1. signed in            -> /en/dashboard
2. cold start lands on  -> /en/dashboard
3. auth calls made      -> 200 /auth/refresh
4. SW controlling page  -> true
5. shows dashboard      -> true
```

The session survives via `/auth/refresh`; the worker does not interfere.

### Known gaps

- **`offline.html` is only partly translated.** It must render with no JS and no network, so
  it cannot use next-intl. English, Hindi and Arabic are inline; the other 19 locales see
  English. A translator task.
- **Cached assets are not trimmed.** Old hashed bundles linger after a deploy until the
  browser evicts under storage pressure. Acceptable for now; if it bites on low-storage
  devices, add an LRU trim on `activate`.
- **Deploy invalidation is proven structurally, not by a full rebuild cycle.** HTML is never
  cached (asserted by test) and assets are hashed, so no stale-shell path exists. A literal
  build → change → rebuild run was not performed.
- **`pwa.install.*` copy is English-only**, like every other new key in this repo; other
  locales merge over English.

---

## Unit 3 — TWA wrapper + Play Store packaging

The TWA is a thin Android shell that opens the **already-deployed web app** fullscreen.
There is no second codebase and no second deployment: a web deploy is live inside the
installed app immediately, with no store release cycle.

Almost all of this unit is a runbook for a human. The only code is one static file and its
regression test.

### What shipped

| File | Purpose |
| --- | --- |
| `apps/web/public/.well-known/assetlinks.json` | Digital Asset Links statement — **placeholders, not shippable as-is** |
| `tests/pwa/assetlinks.spec.ts` | Guards the shape and the delivery |

### 🚧 BLOCKED — two decisions before the runbook can be executed

Neither can be guessed, and both are recorded here rather than worked around.

**B1. Which origin does the TWA open? — OPEN. Answerable only from the Render dashboard.**

**Platform: VERCEL.** Confirmed by hitting the live site, not by reading the repo —
`https://skillindiaconnect-web.vercel.app/en` returns 200.

`render.yaml` does define a `skillindiaconnect-web` Docker service, which is what made an
earlier read of this conclude "Render, not Vercel". That was wrong: the web app answers on
Vercel today. Treat `render.yaml`'s web block as stale or unused for the frontend, and trust
the live origin over any file in this repo.

> **Current origin (testing):** `https://skillindiaconnect-web.vercel.app`
> This is a **platform default**, not a custom domain — see the warning below, because
> building the TWA against it and moving later is the expensive path.

**Where to get it:** Render dashboard → `skillindiaconnect-web` → the URL at the top. That
is either the platform default (`https://skillindiaconnect-web.onrender.com`) or a custom
domain if one is attached under *Settings → Custom Domains*.

`assetlinks.json` must be served from **the exact origin the TWA opens** — scheme and host
must match. If the app opens `https://app.example.com` and the statement lives on
`https://www.example.com`, verification fails and the address bar stays.

> ### ⚠️ Decide the custom domain BEFORE launch, not after
>
> Changing the origin later is not a config tweak. It means: move `assetlinks.json` to the
> new origin, regenerate the TWA against the new host, **republish through Play review**, and
> every already-installed app keeps pointing at the old origin until the user updates. If a
> custom domain is coming, attach it first and build the wrapper against it.
>
> **Fill in:** production origin = `___________________________`
> **Fill in:** platform default or custom domain? = `___________________________`
> **Fill in:** custom-domain move planned before launch? ☐ no  ☐ yes → do it first

**B2. Who holds the Play signing key? — DECIDED: Play App Signing.**
A self-managed key is an unrecoverable single point of failure for a three-person team.
Play App Signing makes a lost *upload* key resettable; Google holds the app signing key.
Details and the exact fingerprint path are below.

> **Fill in:** key custodian (holds the upload key) = `___________________________`

---

### Digital Asset Links — the step that fails silently

If this is wrong the app **still opens** — with a Chrome address bar across the top. It does
not error. It just looks like a broken web page in a frame, and the usual reaction is to
blame the wrapper rather than a JSON file.

**Verified working mechanism** (probed on this app, not assumed):

- `public/.well-known/` is served by Next: `GET /.well-known/assetlinks.json` → `200`,
  `Content-Type: application/json`.
- The next-intl middleware matcher excludes any path containing a dot, so the file is **not**
  locale-redirected to `/en/.well-known/...`. Android does not follow that redirect.

Both properties are asserted by `tests/pwa/assetlinks.spec.ts`, so a future middleware change
that starts swallowing the path fails a test instead of shipping.

**The file today is deliberately unshippable:**

```json
"package_name": "REPLACE_ME_ANDROID_PACKAGE_NAME",
"sha256_cert_fingerprints": ["REPLACE_ME_SHA256_FINGERPRINT_FROM_PLAY_CONSOLE"]
```

Neither placeholder is valid hex or a valid package name, so it cannot be mistaken for a real
value and shipped by accident. The test asserts **shape, not fingerprint value** — the value
differs between a debug build, a self-managed key and Play App Signing, so pinning it would
make the test lie in CI while passing on exactly one machine.

**How to verify it actually works** — three checks, weakest to strongest:

1. **The file is reachable.**
   `curl -sI https://<ORIGIN>/.well-known/assetlinks.json`
   Expect `200` and a JSON content type. A `307`/`308` means the middleware grabbed it.

2. **Google can parse and match it.** This is the authoritative check:
   ```
   https://digitalassetlinks.googleapis.com/v1/statements:list
     ?source.web.site=https://<ORIGIN>
     &relation=delegate_permission/common.handle_all_urls
   ```
   - **Working:** a `statements` array containing your `package_name`, and
     `"debugString"` reporting no errors.
   - **Failing:** an empty `statements` array, or a `debugString` naming the problem
     (unreachable file, bad content type, malformed JSON, fingerprint mismatch).
   Google **caches** this. Allow time after a change, and re-query rather than trusting a
   stale success.

3. **On the device, which is the only check that counts.** Install the release build and
   launch it. **No address bar = verified.** An address bar = the statement did not match,
   regardless of what steps 1 and 2 said.

> Fingerprint mismatch is the usual cause, and it is usually because the **upload key** was
> used instead of the **app signing key** Google re-signs with. See below.

---

### Signing key custody — read this before generating anything

**If the signing key is lost, the app can never be updated.** Not "re-upload with effort" —
Play will refuse the upload permanently. The only path forward is a **new listing with a new
package name and a new URL**, and every existing install is stranded on the last version they
got, with no upgrade path and no way to reach those users.

**Decision: Play App Signing.** The table is kept because the distinction is exactly what
causes the address-bar failure below.

| | Play App Signing (recommended) | Self-managed |
| --- | --- | --- |
| Who holds the **app signing key** | Google | You |
| Who holds the **upload key** | You | (same key) |
| Lose your key | Recoverable — reset the upload key with Google | **Terminal** |
| Fingerprint for `assetlinks.json` | **Play Console → Setup → App Integrity → App signing key certificate → SHA-256** | Your keystore's SHA-256 |

**⚠️ The single most common Asset Links failure — and we are exposed to it by choosing Play
App Signing.** Google re-signs the app with *its* key, so the fingerprint that must go into
`assetlinks.json` is **not** the one your build produced. Using the upload key gives you an
app that installs, opens, and shows a Chrome address bar — with no error anywhere.

Take the fingerprint from exactly here:

> **Play Console → Setup → App Integrity → App signing key certificate → SHA-256 certificate fingerprint**

Not from your local keystore. Not from `bubblewrap`'s output. Not from the *Upload key
certificate* block on that same page — which sits directly beneath it and looks identical.

> **Fill in:** keystore location = `___________________________`
> **Fill in:** backed up where (must not be the same machine) = `___________________________`
> **Fill in:** who else can access it = `___________________________`

---

### TWA generation runbook

**Tool: Bubblewrap CLI** (`@bubblewrap/cli`, Google's own). Chosen over PWABuilder because it
is scriptable, config lives in a committed `twa-manifest.json`, and regenerating after a
manifest change is one command rather than a wizard. It is **not** added to this repo's
dependencies — it is a one-off developer tool, run from anywhere.

```
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://<ORIGIN>/en/manifest.webmanifest
```

**Values that must match Unit 1's manifest** — a mismatch is what makes the splash flash a
different colour, or the app launch to the wrong place:

| Bubblewrap asks | Answer | Source |
| --- | --- | --- |
| Host | `<ORIGIN>` | B1 above |
| Start URL | `/en` (see note) | manifest `start_url` |
| Name / short name | Skill India Connect / Skill India | manifest |
| Theme colour | `#1a3c6e` | `--color-primary-700` |
| Background colour | `#ffffff` | `--background` |
| Icon | `/icons/icon-512.png` | manifest |
| Maskable icon | `/icons/icon-maskable-512.png` | manifest |

> **Locale note.** Unit 1 serves a manifest **per locale** with `start_url: /{locale}`. A TWA
> is built from **one** of them, so the wrapper pins one launch locale. `/en` is the safe
> default — it is the fallback locale, and users switch language in-app on first run. Building
> per-locale TWAs would mean 22 Play listings and is not proposed.

```
bubblewrap build       # produces app-release-bundle.aab + signs it
```

Then take the SHA-256 fingerprint (per the custody table above), put it into
`apps/web/public/.well-known/assetlinks.json`, **deploy the web app**, and only then verify.
The statement must be live *before* the verified build is installed.

---

### Play Console runbook

Dashboard work — fill the blanks as you go.

**1. Create the app**
> Package name = `___________________________` (must match `assetlinks.json`)
> App name = `___________________________`
> Default language = `___________________________`

**2. Store listing**
- Short description (≤80 chars) — `___________________________`
- Full description (≤4000 chars) — lead with what a worker gets: verified employers,
  accommodation/insurance/transport stated on every Gulf job, free for workers.
- Screenshots: **phone screenshots are mandatory.** Capture from a real device at the
  target size, not a desktop browser resized.
  > Suggested set: job search, a job detail showing the benefit chips, the profile, the
  > application status screen.
- Feature graphic 1024×500 — `___________________________`
- App icon 512×512 → use `apps/web/public/icons/icon-512.png`

**3. Content rating** — complete the questionnaire.
> Expect a low rating; the app has no user-generated public content, no ads, no gambling.
> Employer↔candidate messaging is not in-app (WhatsApp/email), which simplifies this.
> Result = `___________________________`

**4. Privacy policy URL** — required.
> `https://<ORIGIN>/en/privacy` — the page exists. See the gap review below.

**5. Data safety** — the section that gets apps pulled. Mapped from the schema below.

---

### Data-safety declaration — mapped from what the code actually stores

Grounded in `apps/api/prisma/schema.prisma` and `apps/api/src/candidate/purge/`.

| Play category | What we actually collect | Purpose | Shared? | Required? |
| --- | --- | --- | --- | --- |
| Name | `fullName`, `fatherName` (optional) | Profile, employer matching | With employers you apply to | Name yes, father's name no |
| Email address | `users.email` | Account, notifications | No | Yes |
| Phone number | `phone` + verification, `whatsappCapable` | Account, WhatsApp notifications | With employers **only if `showPhone`** | Yes |
| Date of birth | `dob` | Eligibility, profile | With employers | No |
| Photos | `photoKey` (profile photo) | Profile | With employers | No |
| **Videos** | `videoR2Key` (intro video, up to 500 MB / 5 min) — **shipped and live**, see gap review | Profile | With employers | No |
| Race/ethnicity or religion | `religion` — **optional, hidden by default** | Employer preference matching | Only if the candidate enables it | No |
| Other personal info | `nationality`, `currentLocation`, `languages`, `summary`, salary expectations | Matching | With employers | No |
| Files and docs | `CandidateDocument` — passport etc.: `documentNumber`, `expiryDate`, files in R2 | Verification, emigration compliance | With employers via **short-expiry signed links**, every issuance audited | Required to apply |
| App activity | `saved_jobs`, applications | Core function | No | — |
| Device/other IDs | IP + userAgent on `refresh_sessions` | Security, session management | No | — |

**Security practices to declare:** data encrypted in transit; documents served only through
short-expiry signed URLs; passwords hashed with argon2id.

**Deletion — declare "users can request data deletion", and describe it accurately:**

- A 30-day grace window (`deletionDueAt`), then a daily sweep purges.
- **Deleted outright:** refresh sessions (IP, userAgent), OTP challenges, notifications,
  saved jobs, resumes and generated PDFs (R2 objects destroyed), **candidate documents
  including passport numbers** (R2 destroyed), work experiences, skills.
- **Anonymised/tombstoned:** the candidate profile and the user row (email tombstone).
- **⚠️ RETAINED:** orders, payments, subscriptions, invoices and audit logs — kept for tax,
  accounting and audit obligations.

> That last line must be in the declaration. Claiming complete deletion while financial
> records are retained is exactly the kind of inaccuracy that gets an app pulled — and the
> existing privacy policy already discloses it ("We keep payment, invoice and audit records
> for as long as the law requires"), so the form and the policy would otherwise contradict
> each other.

---

### Privacy policy — gap review

`/{locale}/privacy` is a real 19-section policy, not a stub, and already covers deletion with
the 30-day window, retained financial records, religion and father's name as optional and
hidden, passport documents, Google sign-in, and the `sic_refresh` cookie.

**Three things the code collects that the policy never mentions:**

| Missing | Where it is collected | Shipped? |
| --- | --- | --- |
| **Intro video** | `videoR2Key`, `videoDurationSec`, `videoSizeBytes`, `videoUploadedAt` | **Yes — live, not Phase 2** |
| **Profile photo** | `photoKey` | Yes |
| **Nationality** | `nationality` | Yes |

#### The intro video is live today — it was not deferred

This was checked because the feature had been *believed* to be Phase 2. It is not:

- **Five routes** are wired in `candidate.controller.ts`: `GET me/video`,
  `POST me/video/presign`, `POST me/video/confirm`, `GET me/video/url`, `DELETE me/video`.
- `video.service.ts:172` performs the write: `videoR2Key: dto.key`.
- The endpoint answers on a live server:
  `{"hasVideo":false,"maxMb":500,"maxDurationSec":300}` — a 500 MB / 5-minute media capability.
- The upload component `VideoIntroUpload` is mounted in **two** places a candidate reaches
  normally: onboarding (`PreviewExportStep`) and the profile (`DocumentsSection`).
- It is **not** behind a feature flag. The only `disabled` in the component is a transient
  busy state during upload.
- Shipped in `0d1fb44 feat: add video upload functionality for candidates`.

**Zero rows currently have `videoR2Key` set** in the dev database (and zero have `photoKey`).
That is not a reason to omit it:

> Play's data-safety form asks what the app **collects**, not what it **has collected**. A
> shipped, unflagged upload control in two places means the first candidate to use it makes
> the declaration false — and review happens before that user exists. A declaration that is
> accurate only until someone taps a button is not accurate.

**DECIDED: all three go to legal in one pass.** Splitting video out is not a smaller ask — it
is the same review of the same section, plus a second review later, plus a window in which the
declaration is wrong.

#### Brief for legal — treat the video as its own category, not as profile data

A **500 MB / 5-minute video of a person** is meaningfully more sensitive than the text fields
around it. Play has a dedicated *Photos and videos* category for exactly that reason, and the
policy language should follow suit rather than folding it into a general "profile information"
sentence alongside name and location.

Specifically, ask legal to cover:

- that a video **of the candidate themselves** is collected, and that it is optional;
- who can see it (employers the candidate applies to) and through what mechanism
  (short-expiry signed links, as with documents);
- that it is deleted from storage on account deletion — the purge already destroys the R2
  object, so this is describing behaviour that exists, not promising new work;
- whether a video of a person triggers any additional obligation under the DPDP Act that the
  text fields do not.

The policy also carries a `draftNotice` flag and is dated `2026-08-02`.

> **Do not fix this in code.** Adding sentences to a privacy policy is a legal review, not a
> content edit. Take this list to whoever reviews the job-posting terms.
> **Action:** ☐ policy updated  ☐ data-safety form matches the updated policy

---

### The throwaway test APK — built, and how to rebuild it

A disposable sideload build whose **only** job is proving the mechanism: does the wrapper open
fullscreen with no address bar? It never touches Play.

> **Built:** `skillindiaconnect-TEST-ONLY.apk` (3.5 MB), signed, Asset Links verified by
> Google. Copied to `~/Downloads/`.

#### Toolchain (one-off, ~1 GB)

```
npm i -g @bubblewrap/cli
yes | bubblewrap doctor      # downloads JDK 17 + Android SDK to ~/.bubblewrap
```

Installing the SDK requires accepting the
[Android SDK Terms](https://developer.android.com/studio/terms.html).

#### The disposable key — never the release key

Named so it cannot be mistaken for one, and generated **outside the repo** so it can never be
committed:

```
keytool -genkeypair -v -keystore test-only.keystore -alias test-only \
  -keyalg RSA -keysize 2048 -validity 3650 \
  -storepass testonly -keypass testonly \
  -dname "CN=SKILL INDIA CONNECT TEST ONLY - NOT FOR RELEASE, OU=Testing, O=DO NOT USE FOR PLAY, ..."
```

Its SHA-256 went into `assetlinks.json` so the sideloaded build verifies — **without that step
the APK proves nothing**, because it would open with an address bar for the ordinary reason
rather than because the wrapper is broken.

#### Build

```
bubblewrap init --manifest=https://skillindiaconnect-web.vercel.app/en/manifest.webmanifest
# patch twa-manifest.json (see traps), then:
./gradlew.bat assembleRelease
zipalign -p -f 4 app/build/outputs/apk/release/app-release-unsigned.apk out.apk
apksigner sign --ks test-only.keystore --ks-key-alias test-only out.apk
apksigner verify --print-certs out.apk
```

#### Four traps hit while doing this — all cost real time

1. **`enableNotifications` defaults to `true`.** Bubblewrap turns it on regardless of the web
   manifest. Left alone, the app requests notification permission on first run — the exact
   thing push-being-out-of-scope was supposed to prevent. **Set it to `false` in
   `twa-manifest.json` and re-run `bubblewrap update`.**
2. **`bubblewrap build` cannot spawn `gradlew.bat`** on Windows — it invokes it without `./`,
   which neither Git Bash nor its cmd child resolves. Run `./gradlew.bat assembleRelease`
   directly and sign with `apksigner` afterwards; the result is identical.
3. **SDK licence prompts ignore piped input.** `yes | sdkmanager --licenses` silently fails
   and the build then dies on a missing `build-tools`. Real stdin redirection works:
   `cmd /c "sdkmanager.bat --sdk_root=... --licenses < yes.txt"`.
4. **`sdkmanager` needs `--sdk_root`** when the SDK sits at `~/.bubblewrap/android_sdk`;
   without it, it prints help and exits 0, which looks like success.

#### Verifying before you burn a build

Check the statement is live **before** building — Google's API is authoritative and takes
seconds:

```
curl "https://digitalassetlinks.googleapis.com/v1/statements:list\
?source.web.site=https://skillindiaconnect-web.vercel.app\
&relation=delegate_permission/common.handle_all_urls"
```

Confirmed for this build: **1 statement**, package `app.vercel.skillindiaconnect_web.twa`,
fingerprint `8A:55:68:…`, no errors. The signed APK's certificate digest matches byte-for-byte.

#### 🔴 Before anything goes to Play — undo this

The test fingerprint is **live on the production origin right now**. While it is there, any
build signed with that disposable keystore is trusted by the origin with no address bar. The
keystore is local and this is a testing domain, so exposure is bounded — but it is not
something to leave sitting.

> ☐ Replace the fingerprint in `apps/web/public/.well-known/assetlinks.json` with the **Play
>   App Signing** one (*Setup → App Integrity → App signing key certificate → SHA-256*)
> ☐ Replace `package_name` with the real Play package
> ☐ Delete `test-only.keystore`
> ☐ Re-run the statements API check against the new fingerprint
> ☐ Rebuild the wrapper against the **real domain**, not `*.vercel.app`

---

### Rollback

**The web app is unaffected by anything in this unit, in either direction.** The TWA is a
shell over the same origin — no separate build, no separate data. Browser users never see a
change.

| Situation | Action | Effect on the web app |
| --- | --- | --- |
| Wrapper misbehaves before launch | Halt the release in Play Console | None |
| Released, needs pulling | Play Console → *Release → Setup → Advanced → Unpublish* | None |
| Bad version, good previous one | Roll back to the previous release in the track | None |
| Asset Links wrong (address bar showing) | Fix the fingerprint, **deploy the web app** — no store release needed | None |
| Something wrong with the app content | **Just deploy the web app.** The TWA picks it up immediately | It is the fix |

Note the asymmetry that makes this architecture worth it: **only a change to the wrapper
itself needs a store release.** Everything else is a normal web deploy.

Unpublishing removes the listing from Play; it does **not** uninstall the app from devices
that already have it. Those installs keep opening the live web app, which is the correct
behaviour — they degrade to a browser-quality experience, not a broken one.

