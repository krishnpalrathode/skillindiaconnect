import { ResumeViewDto } from '../resume-view.mapper';
import {
  contactParts,
  documentFooter,
  documentLabel,
  durationLabel,
  esc,
  factRows,
  pageFrame,
  safePhotoSrc,
  stickyFooterFrame,
  summaryText,
} from './shared';

/**
 * SLATE — the second MODERN-family template.
 *
 * Its one idea is the AT-A-GLANCE BAND: a tinted strip directly under the name
 * holding the facts a Gulf recruiter checks first (nationality, date of birth,
 * languages, passport) as inline chips rather than as a labelled table. On every
 * other template those facts sit in a block the reader has to parse; here they
 * are scannable in a single pass, which is what someone working through fifty
 * files actually does.
 *
 * HOW IT DIFFERS from the templates it sits beside — a gallery is a lie if two
 * entries produce near-identical documents:
 *  - MODERN: photo-led flex header, facts as a labelled list, teal hairlines.
 *    SLATE carries no photo and leads with type.
 *  - EXECUTIVE: full-bleed colour band and `@page margin: 0`. SLATE keeps normal
 *    margins; its colour is a contained strip, never a bleed.
 *  - COMPACT: a real two-column grid. SLATE is single-column throughout, so it
 *    cannot develop COMPACT's empty-sidebar problem on a thin profile.
 *
 * Section headings carry a short heavy accent bar instead of a full-width rule,
 * which gives the page its rhythm without adding yet another horizontal line to
 * a document that already has several.
 *
 * Hard rules (identical across every template here):
 * - Everything inline; Chromium fetches NOTHING at render time.
 * - Latin system fonts only; English MVP, no bidi/RTL.
 * - Renders ONLY what the ResumeView carries — the mapper is the omission
 *   chokepoint; there is no `settings` logic here on purpose.
 * - Every interpolated value passes through esc(); profile text is user input.
 * - Video Portfolio renders only when a video exists — never a placeholder.
 */
const INK = '#0f172a';
const ACCENT = '#2563eb';
const BAND = '#f1f5f9';

/** Heading with the short accent bar. Used by every section below. */
function heading(text: string): string {
  return `<h2><span class="bar" aria-hidden="true"></span>${esc(text)}</h2>`;
}

/**
 * The at-a-glance band — this template's signature.
 *
 * Returns '' when the view carries no facts, so a sparse profile gets no empty
 * tinted strip. `factRows` has already dropped whatever the mapper withheld, so
 * nothing here can reinstate a hidden field.
 */
function glanceBand(view: ResumeViewDto): string {
  const rows = factRows(view);
  if (rows.length === 0) return '';
  const chips = rows
    .map(
      ([label, value]) =>
        `<span class="chip"><span class="k">${esc(label)}</span>${esc(value)}</span>`,
    )
    .join('');
  return `<div class="glance">${chips}</div>`;
}

function experienceSection(view: ResumeViewDto): string {
  if (view.experiences.length === 0) return '';
  const items = view.experiences
    .map((e) => {
      const duration = durationLabel(e.years, e.months);
      const meta = [e.country, e.type === 'FOREIGN' ? 'Overseas experience' : '']
        .filter(Boolean)
        .map(esc)
        .join(' &middot; ');
      return `<li>
        <div class="row">
          <p class="jobrole">${esc(e.role)}</p>
          ${duration ? `<span class="dur">${esc(duration)}</span>` : ''}
        </div>
        <p class="co">${esc(e.companyName)}</p>
        ${meta ? `<p class="meta">${meta}</p>` : ''}
      </li>`;
    })
    .join('\n');
  return `<section>${heading('Work Experience')}<ul class="exp">${items}</ul></section>`;
}

function skillsSection(view: ResumeViewDto): string {
  if (view.skills.length === 0) return '';
  const chips = view.skills.map((s) => `<span class="skill">${esc(s.name)}</span>`).join('');
  return `<section>${heading('Skills')}<p class="skills">${chips}</p></section>`;
}

function documentsSection(view: ResumeViewDto): string {
  if (view.documents.length === 0) return '';
  const items = view.documents
    .map((d) => {
      const validity =
        d.passportValid === undefined ? '' : d.passportValid ? ' (valid)' : ' (expired)';
      return `<li>${esc(documentLabel(d.type))}${validity}</li>`;
    })
    .join('\n');
  return `<section>${heading('Documents')}<ul class="docs">${items}</ul></section>`;
}

export function renderSlate(view: ResumeViewDto): string {
  // No photo by design — this template leads with type. Resolved anyway so the
  // shared data-URI guard stays on the one code path every template uses.
  void safePhotoSrc(view);

  const summary = summaryText(view);
  const video = view.hasVideo
    ? `<section>${heading('Video Portfolio')}<p>A video introduction is available on Skill India Connect.</p></section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  ${pageFrame('16mm 15mm')}
  ${stickyFooterFrame()}
  body {
    font-family: "Segoe UI", -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 10.5pt; color: ${INK}; line-height: 1.5;
  }

  header { margin-bottom: 5mm; }
  h1 { font-size: 26pt; font-weight: 700; letter-spacing: -0.02em; line-height: 1.05; }
  .headline {
    font-size: 9.5pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.16em; color: ${ACCENT}; margin-top: 1.5mm;
  }
  .contact { font-size: 9.5pt; color: #475569; margin-top: 2.5mm; }

  /* The signature band. Rounded and tinted so it reads as one object rather
     than as another row of loose text. */
  .glance {
    background: ${BAND}; border-radius: 2.5mm; padding: 3mm 3.5mm;
    margin-bottom: 7mm; display: flex; flex-wrap: wrap; gap: 1.5mm 5mm;
  }
  .chip { font-size: 9.5pt; white-space: nowrap; }
  .chip .k {
    display: block; font-size: 7.5pt; text-transform: uppercase;
    letter-spacing: 0.09em; color: #64748b; font-weight: 700;
  }

  h2 {
    font-size: 10pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; margin-bottom: 3mm; display: flex;
    align-items: center; gap: 2.5mm;
  }
  .bar {
    display: inline-block; width: 6mm; height: 1.2mm;
    background: ${ACCENT}; border-radius: 1mm;
  }
  section { margin-bottom: 6.5mm; }

  ul.exp { list-style: none; }
  ul.exp li { margin-bottom: 4.5mm; padding-left: 3.5mm; border-left: 0.8pt solid #e2e8f0; }
  ul.exp .row { display: flex; align-items: baseline; gap: 3mm; }
  ul.exp .jobrole { font-size: 11.5pt; font-weight: 700; color: ${INK}; flex: 1; }
  ul.exp .dur { font-size: 9pt; color: #64748b; white-space: nowrap; }
  ul.exp .co { color: #334155; }
  ul.exp .meta { font-size: 9pt; color: #94a3b8; margin-top: 0.5mm; }

  .skills { display: flex; flex-wrap: wrap; gap: 1.5mm; }
  .skill {
    background: ${BAND}; border-radius: 1.5mm; padding: 1mm 2.6mm;
    font-size: 9.5pt; font-weight: 600; color: #334155;
  }

  ul.docs { list-style: none; font-size: 10pt; }
  /* 5mm, not 3.5: an em-dash is wide and at a tighter indent it collided with
     the label — visible as "—Passport" with no gap. */
  ul.docs li { padding-left: 5mm; position: relative; margin-bottom: 0.8mm; }
  ul.docs li::before { content: "\\2014"; color: ${ACCENT}; position: absolute; left: 0; }

  .summary { font-size: 10.5pt; line-height: 1.6; color: #334155; margin-bottom: 6mm; }
  footer { padding-top: 3mm; border-top: 0.6pt solid #e2e8f0; font-size: 8pt; color: #94a3b8; }
</style>
</head>
<body>
  <header>
    <h1>${esc(view.fullName)}</h1>
    ${view.jobCategory ? `<p class="headline">${esc(view.jobCategory)}</p>` : ''}
    <p class="contact">${contactParts(view).map(esc).join(' &nbsp;&middot;&nbsp; ')}</p>
  </header>

  ${glanceBand(view)}

  ${summary ? `<p class="summary">${summary}</p>` : ''}

  <main>
    ${experienceSection(view)}
    ${skillsSection(view)}
    ${documentsSection(view)}
    ${video}
  </main>

  ${documentFooter(view)}
</body>
</html>`;
}
