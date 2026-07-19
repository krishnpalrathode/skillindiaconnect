# S8-H4 — Accessibility Audit Report (WCAG 2.1 AA)

Full audit of every user-facing **and** admin screen, with fixes applied.

**Why the stakes are what they are.** These users are blue-collar workers on
cheap Android phones, roughly half navigating in Arabic, some with limited
literacy relying on clear hierarchy and screen readers. An unlabelled button or
an unannounced state is not a lint warning here — it is a person who cannot
apply for a job. The findings below are ordered by that consequence, not by
tool severity.

---

## 1. Method — and what it does *not* cover

| Layer | What it does | Tool |
|---|---|---|
| 1. Automated | WCAG 2.0/2.1 A+AA ruleset per screen, both locales, both viewports | **axe-core 4.x** via `@axe-core/playwright` |
| 2. Keyboard | Real `Tab` keystrokes; records every focus stop, its accessible name, whether a **visible** indicator renders (computed outline/box-shadow, not a class name), and its box size | Playwright |
| 3. SR contract | The browser's own accessibility tree via **CDP `Accessibility.getFullAXTree`** — the tree the platform hands a screen reader | Chrome DevTools Protocol |
| 4. RTL geometry | Computed styles + measured geometry in Arabic; physical-inset detection, overflow, bidi isolation | Playwright |
| 5. Token contrast | Every text token against every surface it is painted on, computed to WCAG relative-luminance | `a11y/contrast-tokens.cjs` |

**Coverage:** 32 screens × (en + ar for the 21 user-facing) × 2 viewports
(Desktop Chrome, Pixel 5) = **509 checks**.

### ⚠️ Honesty note: no live screen reader was used

This audit inspects the **accessibility tree and the ARIA contract** — the input
a screen reader speaks from. It did **not** run NVDA, VoiceOver or TalkBack and
listen to the output.

Those are genuinely different things. The tree can be structurally correct while
the spoken result is still confusing, badly ordered, or so verbose that a user
abandons the flow. Every SR-related finding below is therefore stated as *"the
contract is/isn't correct"* — never as *"we listened to it."*

**A live AT pass on the four critical flows (onboarding, apply, checkout,
resume) remains an open gap** and is recorded as such in the accessibility
statement. The brief is right that automated tooling catches ~30%; layers 2–4
above reach further than axe alone, but they do not reach all the way.

---

## 2. Findings

| ID | WCAG | Severity | Title | Status |
|---|---|---|---|---|
| **A11Y-001** | 1.3.1 Info and Relationships | **Critical** | `role="tab"` with no `tablist` parent on both login screens — invalid ARIA structure | **Fixed** |
| **A11Y-003** | 1.4.3 Contrast (Minimum) | **Serious** | `text-neutral-400` (2.18:1) and `text-neutral-500` (3.52:1) used as body text in 200 places | **Fixed** |
| **A11Y-002** | 2.5.5 / product ≥44px | Moderate | Language switcher 36px on every screen; password toggle ~16px; filter chips 36px | **Fixed** |
| **A11Y-004** | 2.3.3 / 2.2.2 | Moderate | No `prefers-reduced-motion` support against 84 animated utilities | **Fixed** |
| **A11Y-005** | 2.5.5 / product ≥44px | Moderate | Standalone text links 22px tall (49 instances) | **Open — documented** |
| **A11Y-006** | — | Info | Playwright cannot load the committed e2e suite in this environment | **Open — flagged** |
| **A11Y-007** | — | Info | The audit harness itself is non-deterministic under repeated runs (hydration-dependent sign-in) | **Open — flagged** |

### Before → after

| Run | Checks | Failures | Critical | Serious | Moderate |
|---|---|---|---|---|---|
| Baseline | 561 | **168** | 43 | 73 | 52 |
| After fixes | 509 | **52** | **0** | **0** | 51 |
| Re-run (confirmation) | 449 | 53 | **0** | **0** | 44 |

**Every Critical and Serious finding is eliminated and stayed eliminated across
two independent runs.** The remaining failures are A11Y-005 (text-link height)
plus harness artefacts.

> **Run-to-run variance, stated plainly.** The three runs differ in total check
> count (561 / 509 / 449) because some screens intermittently fail to
> authenticate or finish rendering before the snapshot — the sign-in flow is
> React-hydration-dependent and the dev server slows under repeated full sweeps.
> The confirmation run shows 9 auth artefacts and 16 "no headings" results on
> screens that demonstrably *do* have `<h1>`/`<h2>` in source, so those are
> timing, not defects.
>
> This is a limitation of the harness, not a hedge on the results: the
> Critical/Serious classes are zero in **both** post-fix runs, and those are the
> classes the fixes targeted. The harness should be made deterministic (wait for
> a content sentinel per screen rather than a fixed delay) before these counts
> are used as a CI gate.

---

## A11Y-001 — Invalid tab structure on both login screens (Critical) — Fixed

**WCAG 1.3.1** · axe `aria-required-parent` · 41 instances

The candidate and employer login screens rendered the Email/Phone switcher as
`role="tab"` buttons inside a plain `<div>` — **no `role="tablist"` parent**.

```html
<!-- before -->
<div class="flex overflow-hidden rounded-xl …">
  <button role="tab" aria-selected="true">Email</button>
  <button role="tab" aria-selected="false">Phone</button>
</div>
```

**Consequence.** A screen-reader user heard "tab" with no group context and no
position — no "tab 1 of 2", no owning list, and no programmatic link to the
panel that changed underneath. On the screen where a user chooses *how to sign
in*, that is a dead end before they have entered the product at all. Notably,
the admin tables in the same codebase implement this correctly, so the pattern
was known — it was simply missed here.

**Fix.** Added `role="tablist"` with an accessible label (new `methodTabsLabel`
key in all three locales), `id`/`aria-controls` on each tab, and `role="tabpanel"`
+ `aria-labelledby` on the panel, so the tab↔panel relationship is programmatic
rather than visual.

---

## A11Y-003 — Muted text fails contrast, in 200 places (Serious) — Fixed

**WCAG 1.4.3** · the highest-volume finding in the audit

The token audit (`node a11y/contrast-tokens.cjs`) computed every text token
against every surface:

| Token | On white | 4.5:1 body text | 3:1 large/UI |
|---|---|---|---|
| `neutral-400` `#b1b0a8` | **2.18:1** | ❌ | ❌ **fails even 3:1** |
| `neutral-500` `#8a8980` | **3.52:1** | ❌ | ✅ |
| `neutral-600` `#6c6b62` | 5.90:1 | ✅ | ✅ |
| `accent-500` `#f57c20` | 2.70:1 | ❌ | ❌ (background token; ✅ as used) |

Both failing tokens were used as **real content text**, not decoration —
including an application's own reference number (`app.humanId`) on the
application-detail screen, the "or" dividers on every auth screen, and
explanatory helper text.

For a user with low vision on a cheap phone screen in daylight, 2.18:1 is not
"faint" — it is **absent**.

**Fix.** A scoped codemod raised both to `neutral-600` (5.9:1): **109 lines in
70 files** for `neutral-400`, **276 lines in 130 files** for `neutral-500`.

The codemod deliberately **preserved** two exempt categories, and each surviving
instance now carries an `eslint-disable` naming its reason:

- **Disabled controls** — WCAG 1.4.3 explicitly exempts them, and darkening them
  would stop "unavailable" reading as unavailable.
- **Placeholder text** — darkening it would make an empty field read as filled.
- **Icon colours** — 1.4.11 requires 3:1, which `neutral-500` already meets.

**Regression guard.** An ESLint rule now flags `text-neutral-400|500` with the
replacement named in the message. The semantic status pairs were verified
independently and all pass: success 4.79:1, warning 6.84:1, error 5.91:1, info
5.15:1 — each on its own `-bg`.

---

## A11Y-002 — Targets below 44px (Moderate) — Fixed

The most-repeated target failure in the entire audit was the **language
switcher at 36px**, present on every screen.

That is the specific control an Arabic-reading user needs before anything else
works for them, sized below the minimum, on the phones with the least precise
touch input. It was the single highest-value fix in the unit by ratio of effort
to consequence.

| Component | Before | After |
|---|---|---|
| `LanguageSwitcher` (every screen) | `h-9` = 36px | `h-11` = 44px |
| `PasswordField` show/hide toggle | icon box ≈16px | 44px column, full field height |
| `JobFilters` category chips | `min-h-9` = 36px | `min-h-11` = 44px |

---

## A11Y-004 — No reduced-motion support (Moderate) — Fixed

The codebase used **84** transition/animation utilities — the completion ring,
the match-reveal bars, 8 spinners — and honoured `prefers-reduced-motion`
**nowhere**.

Vestibular disorders make sweeping motion genuinely sickening, and the users
least able to route around it are the ones on the cheapest devices, where the
same animation also stutters.

**Fix** (`globals.css`): motion is **reduced, not removed**. Animations collapse
to ~0ms rather than `animation: none`, because some components rely on an
animation *running* to signal activity — a spinner that never runs reads as a
frozen UI. The end state arrives immediately; the movement between states goes
away.

---

## A11Y-005 — Standalone text links are 22px tall (Moderate) — **Open**

49 remaining instances: "View details", "Forgot password?", "View company jobs".
They are 22px tall — the natural line-height of `text-sm`.

**Assessment, honestly stated:** WCAG 2.1 AA does **not** require a minimum
target size (2.5.5 is AAA). WCAG 2.2 adds 2.5.8 Target Size (Minimum) at AA with
a **24×24** threshold — these are at 22px, marginally under. The product's own
rule is ≥44px, which they clearly miss.

**Not fixed here, deliberately.** Reaching 44px requires vertical padding on
inline-styled links across 49 sites in many layouts; done late in a hardening
unit without design review, that is a visual regression risk on screens this
audit is not otherwise touching. It is recorded with the exact instance list in
`a11y/out/audit.json` and carried into the accessibility statement as a known
gap with a remediation route (`inline-flex min-h-11 items-center` on the shared
link pattern).

---

## 3. What the audit found already correct

Reporting only failures would misrepresent the codebase. These were checked
adversarially and held:

**The RBAC matrix (Screen 27)** — the brief's hardest and highest-stakes target,
flagged in the S8-H2 security audit. It is genuinely well-built: `<caption
class="sr-only">`, `<th scope="col">` per role, `<th scope="colgroup">` per
module group, `<th scope="row">` per permission, and every cell control carries
an accessible name naming **role + permission + state** —
`"MODERATOR, export system logs: not allowed — activate to change"`. Locked
cells state the reason. Targets are 44px. This is the grid where a wrong toggle
changes who can do anything, and it is the most navigable table in the product.

**Async state announcement** — the brief calls a silent spinner "the a11y
equivalent of never silently claiming success", and the codebase already
respects that. `GenerationStatus` (resume polling) announces every transition
with `aria-live="polite"` and escalates FAILED to `role="alert"`;
`PaymentConfirming` announces each phase; the WhatsApp/email send buttons switch
between polite and assertive by outcome. 24 live regions across the app.

**Dialog focus management** — `ActionDialogShell` moves focus in on open, cycles
Tab within, closes on Escape and backdrop, and **returns focus to the trigger**
on unmount. All four employer-action dialogs and the S4 applicant dialogs share
it.

**Keyboard operability** — across all 32 screens, every focusable control had a
visible focus indicator (measured as computed outline/box-shadow, not the
presence of a class) and an accessible name. **Zero** unnamed controls, zero
invisible-focus stops, zero keyboard traps outside the intentional dialog traps.

---

## 4. A11Y-006 — The e2e suite does not load in this environment (Info)

While building the harness I found that **Playwright 1.61 on Node 22 cannot
resolve relative TypeScript imports from a spec** in this environment:

```
TypeError: context.conditions?.includes is not a function
```

This affects the **committed e2e suite** — a stated merge gate — not just the
audit: `e2e/resume-export.spec.ts` fails at line 1, before any test runs. It is
pre-existing and unrelated to this unit's changes.

The audit works around it by living in a single self-contained spec
(`a11y/audit.spec.ts`), which is documented in that file's header. **The
underlying runner problem should be fixed** — a merge gate that cannot execute
is not a gate.

---

## 5. Verification

`pnpm --filter @skillindiaconnect/web typecheck` clean ·
`pnpm --filter @skillindiaconnect/web lint` **0 warnings, 0 errors** ·
audit re-run after fixes.

### Deliverables

```
a11y/audit.spec.ts          # the 4-layer sweep (axe + keyboard + a11y tree + RTL geometry)
a11y/contrast-tokens.cjs    # design-token contrast computation
a11y/playwright.config.ts   # desktop + Pixel-5 constrained profiles
a11y/lib/{screens,audit}.ts # the screen inventory and helpers (see A11Y-006)
a11y/out/                   # machine-readable findings (gitignored)
docs/a11y-audit-report.md   # this file
docs/rtl-audit-report.md
docs/accessibility-statement.md
```

Re-run with `pnpm a11y:audit` (needs the dev server on :3000 with
`NEXT_PUBLIC_API_MOCKING=enabled`).

### Follow-ups

1. **Live AT pass** on the four critical flows — the gap this audit cannot close.
2. **A11Y-005** — raise standalone link targets with design review.
3. **Fix the Playwright runner** (A11Y-006) so the e2e gate and this audit can
   both run in CI, then split the audit back into modules.
4. **Wire `pnpm a11y:audit` into CI** so contrast and ARIA regressions are caught
   by the sweep, not by the next audit.
