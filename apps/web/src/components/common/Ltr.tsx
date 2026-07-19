import React from 'react';
import { cn } from '@/lib/utils';

/**
 * RTL-001 (S8-H4) — bidi isolation for numeric and Latin-script runs.
 *
 * THE most common RTL mistake, and the one this audit found systemically: the
 * codebase had no bidi isolation anywhere (no `<bdi>`, no `dir="ltr"`, no
 * `unicode-bidi`). Layout mirrored correctly, but the CONTENT inside it did
 * not always survive the mirror.
 *
 * Why a plain string breaks. The Unicode bidi algorithm classifies digits as
 * WEAK and punctuation/spaces as NEUTRAL, so their final order is decided by
 * the surrounding paragraph direction. Inside an RTL paragraph that reorders
 * exactly the strings this product shows to Gulf users:
 *
 *   "AED 3,000–AED 5,000"   → the range can render with the bounds swapped,
 *                             so the maximum reads as the minimum
 *   "+91 98765 43210"       → the leading '+' migrates to the far end
 *   "12 / 05 / 2026"        → the date components reorder
 *   "85%"                   → the '%' jumps to the wrong side
 *
 * A salary whose bounds are swapped is not a cosmetic bug — it is wrong
 * information about pay, shown to someone deciding whether to take a job
 * abroad. `<bdi>` (bidi isolate) is the HTML element that exists precisely for
 * this: it isolates its contents from the surrounding direction so the run is
 * ordered on its own terms, while the element itself still flows in the
 * mirrored layout.
 *
 * Use for: salaries, currency, phone numbers, dates, percentages, match
 * scores, human ids (JB-2026-1), emails and company names in Latin script.
 * Do NOT use for ordinary translated prose — that must mirror.
 */
const ISOLATE = '[unicode-bidi:isolate]';

export function Ltr({
  children,
  className,
  as: Tag = 'bdi',
}: {
  children: React.ReactNode;
  className?: string;
  /** Escape hatch for cases needing a different element; defaults to <bdi>. */
  as?: 'bdi' | 'span';
}) {
  // `dir="ltr"` pins the internal order; `unicode-bidi: isolate` (already the
  // default for <bdi>, restated so the <span> escape hatch behaves the same)
  // keeps it from disturbing the surrounding RTL run.
  //
  // The no-className path skips `cn()` deliberately. This component sits inside
  // the job form's live preview, which re-renders on every keystroke via
  // useDeferredValue — running tailwind-merge there is measurable work for a
  // string that never changes, and it was enough to push two already-slow
  // JobForm tests over their timeout.
  const classes = className ? cn(ISOLATE, className) : ISOLATE;

  return (
    <Tag dir="ltr" className={classes}>
      {children}
    </Tag>
  );
}
