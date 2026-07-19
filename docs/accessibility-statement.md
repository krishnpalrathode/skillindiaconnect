# Accessibility Statement — SkillIndiaConnect

**Last reviewed:** 2026-07-19 (Sprint 8 hardening, unit S8-H4)
**Standard:** Web Content Accessibility Guidelines (WCAG) 2.1, Level AA

---

## Our commitment

SkillIndiaConnect connects skilled workers in India with employers in the Gulf
and locally. Many of the people who depend on it are using inexpensive Android
phones, roughly half navigate in Arabic, and some rely on screen readers or on
clear visual hierarchy because they read with difficulty.

For those users, accessibility is not a compliance exercise. An unlabelled
button or an unannounced loading state is the difference between getting a job
and not being able to apply. We treat accessibility defects as functional
defects.

---

## Conformance status

**Partially conformant with WCAG 2.1 Level AA.** "Partially conformant" means
most of the standard is met, with the specific exceptions listed below.

### What conforms

Verified across all 32 screens (candidate, employer, public, and admin), in
English and Arabic, at both a desktop viewport and a constrained Android
profile:

| Area | Status |
|---|---|
| **Keyboard operation** (2.1.1, 2.1.2) | Every interactive control is reachable and operable by keyboard. No keyboard traps outside dialogs, which are Escape-closable. |
| **Visible focus** (2.4.7) | Every focus stop renders a visible indicator, verified by computed style rather than by class name. |
| **Names, roles, values** (4.1.2) | Every focusable control has an accessible name. No unnamed controls found. |
| **Status messages** (4.1.3) | Asynchronous states — payment confirmation, resume generation, message delivery — announce their transitions via live regions rather than showing a silent spinner. |
| **Contrast** (1.4.3) | Body text meets 4.5:1. Muted text was corrected across 200 instances during this audit. Status colours: success 4.79:1, warning 6.84:1, error 5.91:1, info 5.15:1. |
| **Meaning not by colour alone** (1.4.1) | Status badges, validity indicators and pipeline states carry text or an icon plus text, not colour alone. |
| **Info and relationships** (1.3.1) | Data tables use `<caption>`, `<th scope>` and row/column headers. The permissions matrix announces each cell as role + permission + state. |
| **Reflow** (1.4.10) | No horizontal scrolling introduced at the constrained viewport, in either reading direction. |
| **Motion** (2.3.3) | `prefers-reduced-motion` is honoured; animation is reduced to near-instant while preserving end states. |
| **Right-to-left** (1.3.2) | Arabic mirrors correctly across all user-facing screens. Numeric content — salaries, currency, phone numbers — is bidi-isolated so it stays readable. |

### Known gaps

We would rather state these plainly than claim full conformance.

| # | Gap | Impact | Planned |
|---|---|---|---|
| 1 | **No live screen-reader testing.** Our audit inspects the accessibility tree and ARIA contract — the information a screen reader speaks from — but we have not yet run NVDA, VoiceOver or TalkBack and listened to the result. A correct tree can still produce a confusing or overly verbose announcement. | Unknown; the contract is correct, the experience is unverified | Live AT pass on onboarding, apply, checkout and resume — **next sprint** |
| 2 | **Some standalone text links are 22px tall** (e.g. "View details", "Forgot password?"). WCAG 2.1 AA sets no minimum target size; WCAG 2.2 AA requires 24×24, so these fall marginally short of the newer standard and of our own 44px rule. | Harder to tap accurately on a small touchscreen | Raise to 44px with design review — **next sprint** |
| 3 | **Arabic language quality not reviewed.** We verified that Arabic renders and mirrors correctly. We have not had a native Arabic reader review translation quality or phrasing. | Text may be correct but read unnaturally | Native-reader review — **not yet scheduled** |
| 4 | **Hindi not separately audited.** Hindi is left-to-right and shares the English layout, so the RTL findings do not apply, but its typography at small sizes was not specifically reviewed. | Low | Fold into the next audit |
| 5 | **No formal audit by an external accessibility specialist**, and no testing with users who have disabilities. | Self-assessment has blind spots by construction | Under consideration |

---

## How this was assessed

Self-assessment, Sprint 8 (July 2026), combining:

- **axe-core 4.x** automated WCAG 2.0/2.1 A+AA sweep, every screen, both
  languages, two viewports.
- **Real keyboard navigation** driven programmatically — actual `Tab`
  keystrokes, recording every focus stop, its accessible name, and whether a
  visible focus indicator genuinely renders.
- **Accessibility-tree inspection** through the Chrome DevTools Protocol — the
  same tree the operating system exposes to a screen reader.
- **Computed-style and geometry inspection** in Arabic, to distinguish "the
  layout flipped" from "the layout flipped correctly".
- **Design-token contrast computation** against every surface each token is
  painted on.

We note candidly that automated tooling catches only part of what matters. Our
keyboard and accessibility-tree layers reach further than automated checking
alone, but they do not replace listening to a screen reader — which is why gap
#1 above is listed first.

Full findings: [`a11y-audit-report.md`](./a11y-audit-report.md) and
[`rtl-audit-report.md`](./rtl-audit-report.md).

---

## Technical specifications

Accessibility relies on HTML, CSS, JavaScript, WAI-ARIA, and the accessibility
APIs of the user's browser and assistive technology.

**Tested with:** Chromium (desktop + Pixel 5 emulation). Not yet tested with
Safari/VoiceOver, Firefox/NVDA, or Android/TalkBack — see gap #1.

---

## Feedback

If you encounter a barrier, please tell us — reports from people using the
product find problems that audits miss, and we treat them as functional bugs.

- **Email:** accessibility@skillindiaconnect.example
- **Include if you can:** the page, what you were trying to do, and the
  assistive technology and device you were using.

**Target response:** 5 working days.

---

## Review schedule

Reviewed each hardening sprint and whenever a significant new flow ships. The
automated portion (`pnpm a11y:audit`) is intended to run in continuous
integration so contrast and ARIA regressions are caught on the change that
causes them rather than at the next audit.

*This statement describes the state of the product at the date above. It will be
updated as the gaps listed are closed.*
