/**
 * The default "About you" text.
 *
 * ── Why a fixed sentence rather than a generated one ──────────────────────
 * An empty textarea with a placeholder is a writing task, and writing a
 * paragraph about yourself in a second language is exactly the task this
 * audience skips — the field stays blank and the resume loses the one section
 * that sounds like a person. Editing a sentence someone else started is a far
 * smaller ask than filling a blank box.
 *
 * This wording is deliberately GENERIC: it is true of any candidate on the
 * platform, so it can be shown before knowing anything about this one. It is a
 * starting point to personalise, not a description the system is asserting.
 *
 * ── It is a DRAFT, never a save ───────────────────────────────────────────
 * Nothing here is persisted. The text is placed in the box; the candidate edits
 * it and presses Save, exactly as if they had typed it. What reaches the PDF is
 * always something a person read and accepted. A candidate who already has a
 * saved summary never sees this — their own words always win.
 *
 * Kept as ONE exported constant so the copy is reviewed in a single place: it
 * goes out on real documents that real employers read.
 */
export const DEFAULT_ABOUT_YOU =
  'Motivated and hardworking professional seeking opportunities to apply my skills, ' +
  'experience, and knowledge in a growth-oriented organization. I am committed to ' +
  'delivering quality work, learning new skills, and contributing positively to the ' +
  'team while building a successful career.';
