# S8-H4 — Arabic RTL Audit Report

Every user-facing screen rendered in Arabic and checked for **correctness**, not
merely for "it flipped". Admin screens are excluded from RTL by product decision
(EN-only) and appear only in the a11y report.

- **Method:** each screen loaded at `/ar/…` in Chromium at both a desktop
  viewport and the Pixel-5 constrained profile, then inspected via computed
  styles and measured geometry — not by reading source. Computed styles catch
  physical values arriving from a component library or an inline style that a
  source grep would miss.
- **Re-run:** `pnpm a11y:audit` · evidence in `a11y/out/audit.json`.

## Result

| Check | Screens | Result |
|---|---|---|
| `<html dir="rtl">` applied | 21 | ✅ all |
| No horizontal overflow / clipping introduced by the mirror | 21 | ✅ all, both viewports |
| No physical-direction computed styles that fail to mirror | 21 | ✅ all |
| Numeric/currency/phone runs bidi-isolated | 21 | ⚠️ **RTL-001 — systemic gap, fixed** |

---

## RTL-001 — No bidi isolation anywhere (Serious) — **Fixed**

**The finding.** The codebase contained **zero** bidi isolation: no `<bdi>`, no
`dir="ltr"`, no `unicode-bidi` — verified across every `.tsx` and `.css` file.
The layout mirrored correctly; the **content inside it** did not reliably survive
the mirror.

### Why this is the one that matters

The Unicode bidi algorithm classifies digits as **weak** and punctuation/spaces
as **neutral**, so their final order is decided by the surrounding paragraph
direction. Inside an RTL paragraph that reorders exactly the strings this
product shows Gulf candidates:

| Rendered string | Risk in an RTL run |
|---|---|
| `AED 3,000–AED 5,000` | the range bounds can present reversed — **the maximum reads as the minimum** |
| `+91 98765 43210` | the leading `+` migrates to the far end |
| `12 / 05 / 2026` | date components reorder |
| `85%` | the `%` jumps to the wrong side |

A salary whose bounds appear swapped is not a cosmetic defect. It is **wrong
information about pay**, shown to someone deciding whether to take a job in
another country. This is the single highest-stakes RTL failure mode in this
product, and it is exactly the mistake the brief flagged as most common.

### Fix

Added `components/common/Ltr.tsx` — a `<bdi dir="ltr">` primitive with
`unicode-bidi: isolate` — and applied it at the render sites where numeric runs
reach the user inside Arabic text:

| Component | Content isolated |
|---|---|
| `jobs/JobCard.tsx` | salary range (job list, the highest-traffic surface) |
| `jobs/JobDetail.tsx` | salary range |
| `employer/jobform/JobLivePreview.tsx` | salary range (the live preview, Screen 16) |
| `admin/jobs/JobReviewPanel.tsx` | salary range |
| `onboarding/PhoneVerify.tsx` | the phone number being confirmed |

`<bdi>` is the right tool rather than `dir="ltr"` alone: it isolates its
contents from the surrounding direction *and* prevents them from disturbing it,
while the element itself still flows inside the mirrored layout.

> **Scope honesty.** The five sites above are where the audit observed
> user-visible numeric runs inside Arabic text. Other numeric content (match
> scores, KPI counts, dates in list rows) renders inside its own element with no
> adjacent Arabic text in the same run, so the algorithm has nothing to reorder
> it against. Those are lower risk but **not formally proven safe** — see the
> open item at the end.

---

## The flagged leak spots, screen by screen

Each of these was called out across sprints as likely to mirror badly. All were
checked in Arabic at both viewports.

| Leak spot | Screen | Result |
|---|---|---|
| **Application timeline** — connector side + directional flow | Application detail (Screen 08) | ✅ mirrors; connector on the correct side, no overflow |
| **Completion ring** + label | Dashboard, Profile | ✅ mirrors; no physical-inset violations |
| **Match-reveal bars** + component scores | Apply flow, Applicants | ✅ mirror; no physical-direction styles |
| **Mirrored two-column layout** — form + live preview | Job form (Screen 16) | ✅ columns swap correctly |
| **Mirrored two-column layout** | Employer profile, Candidate detail | ✅ swap correctly |
| **Onboarding stepper** — direction + next/back affordances | Candidate + employer onboarding | ✅ mirrors; back/next chevrons flip |
| **Job/candidate cards** — chips, badges, salary+currency | Job search, Job detail, Candidate browse | ✅ layout mirrors; salary now bidi-isolated (RTL-001) |
| **Subscription / billing** — currency amounts | Employer subscription | ✅ mirrors |

### Why these passed

The codebase was built to the logical-property convention and it held up. The
static sweep found **zero** physical utilities (`ml-*`, `mr-*`, `pl-*`, `pr-*`,
`left-*`, `right-*`, `text-left`, `text-right`, `border-l`, `border-r`) across
every component, and the computed-style sweep found no physical `left`/`right`
insets or `text-align: left|right` on any rendered element in any screen.

Directional icons were already handled: `rtl:rotate-180` on the back-arrows and
chevrons, correctly **absent** from non-directional icons (checkmarks, logos).

This is a genuinely good baseline — the RTL discipline was applied during
construction rather than retrofitted, and that is why only one finding came out
of the layout audit.

---

## Regression guard

The physical-utility ban was a review convention (`frontend-conventions.md`) and
therefore only as strong as the reviewer. It is now an **ESLint rule** in
`apps/web/.eslintrc.cjs`: any `ml-*`/`mr-*`/`pl-*`/`pr-*`/`left-*`/`right-*`/
`text-left`/`text-right`/`border-l`/`border-r` in a class string is flagged with
the logical replacement named in the message. Zero violations today; the rule is
what keeps it there.

---

## Open items

1. **No live Arabic-reader review.** Every check here is mechanical — geometry,
   computed styles, bidi isolation. Whether the Arabic *reads well* (translation
   quality, natural phrasing, culturally-correct date/number presentation) is a
   different question that needs a native reader, and this audit does not answer
   it.
2. **Numeric isolation is applied where the audit saw risk, not exhaustively.**
   A follow-up should make `Ltr` the default for every formatted number by
   pushing it into the shared formatters (`lib/jobs/format.ts` and friends), so
   new call sites inherit it rather than needing to remember.
3. **Hindi (`hi`) was not separately audited.** It is LTR and shares the English
   layout paths, so the RTL findings do not apply; its typography and line-height
   at the constrained viewport were not specifically reviewed.
