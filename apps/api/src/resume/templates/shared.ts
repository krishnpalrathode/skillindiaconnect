/**
 * The only things four resume templates are allowed to share.
 *
 * Deliberately small. Sharing the ESCAPING and the PAGE FRAME is necessary;
 * sharing anything visual would make the templates stop being distinct, which
 * is the entire point of offering a choice.
 */
import { ResumeViewDto } from '../resume-view.mapper';

/**
 * THE escaping function — one definition, imported by every template.
 *
 * Not copy-pasted per template on purpose. Four private copies of an escaping
 * routine is a security-relevant duplication: one copy drifts, misses a
 * character, and a company name containing `<` injects markup into the render
 * context. Profile text is user input in every field a template touches.
 */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The photo, validated and escaped, or null.
 *
 * SEC-004 (S8-H2): photoDataUri is the ONE value that lands in an ATTRIBUTE
 * rather than in text. A URI containing a double-quote would close src="" and
 * the remainder becomes attributes — `data:image/png" onload="alert(1)` yields
 * a live handler executing inside the Chromium render context.
 *
 * Not reachable today (the URI is built server-side from an R2 fetch and no
 * endpoint lets a candidate set it), but it is a landmine rather than a live
 * hole, and it must be defused in ONE place rather than in each template —
 * a template that forgot this guard would reintroduce the whole issue.
 *
 * Two independent guards because either alone would do and both are cheap:
 * shape-validate that it really is a data: image URI, and esc() it so a quote
 * can never terminate the attribute.
 */
export function safePhotoSrc(view: ResumeViewDto): string | null {
  const uri = view.photoDataUri;
  if (!uri) return null;
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]*$/.test(uri) ? esc(uri) : null;
}

/**
 * A4 page setup + the reset every template starts from.
 *
 * The MARGINS are intentionally not fixed here — whitespace is a large part of
 * what distinguishes MINIMAL from COMPACT — so each template passes its own.
 */
export function pageFrame(margin: string): string {
  return `
  @page { size: A4; margin: ${margin}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  /* Nothing may bleed across an A4 boundary mid-item. */
  section { break-inside: auto; }
  li, tr { break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; }
  img { max-width: 100%; }
  /* Long unbroken tokens (a URL-ish company name) must wrap, never overflow. */
  body { overflow-wrap: anywhere; word-break: normal; }
`;
}

/** Human label for a document type — shared because it is data, not design. */
export function documentLabel(type: string): string {
  switch (type) {
    case 'PASSPORT':
      return 'Passport';
    case 'EXPERIENCE_CERT':
      return 'Experience certificate';
    case 'EDUCATIONAL_CERT':
      return 'Educational certificate';
    default:
      return type;
  }
}

/** "4 yr 2 mo" / "" — shared formatting, each template decides where it goes. */
export function durationLabel(years: number, months: number): string {
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} yr`);
  if (months > 0) parts.push(`${months} mo`);
  return parts.join(' ');
}

/**
 * The personal-detail rows a template may show, already filtered.
 *
 * Returns ONLY what the ResumeView actually carries. A field the mapper omitted
 * is simply absent from the view, so it never appears in this list and no
 * template can render a label for a value it does not have — that is how "no
 * empty Passport number: row" holds for every template without each one
 * reimplementing the check.
 */
export function factRows(view: ResumeViewDto): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (view.fatherName) rows.push(["Father's name", view.fatherName]);
  if (view.dob) rows.push(['Date of birth', view.dob]);
  if (view.nationality) rows.push(['Nationality', view.nationality]);
  if (view.maritalStatus) rows.push(['Marital status', view.maritalStatus]);
  if (view.religion) rows.push(['Religion', view.religion]);
  if (view.languages.length > 0) rows.push(['Languages', view.languages.join(', ')]);
  if (view.passportNumber) rows.push(['Passport number', view.passportNumber]);
  return rows;
}

/** email · phone · location — only the parts the view carries. */
export function contactParts(view: ResumeViewDto): string[] {
  const parts = [view.email];
  if (view.phone) parts.push(view.phone);
  if (view.currentLocation) parts.push(view.currentLocation);
  return parts;
}
