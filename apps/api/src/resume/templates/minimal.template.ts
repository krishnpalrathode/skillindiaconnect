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
  summaryText,
  stickyFooterFrame,
} from './shared';

/**
 * MINIMAL (CR-001 B2) — maximum whitespace, minimal ornamentation, a plain
 * linear structure. The most ATS-friendly of the four.
 *
 * "ATS-friendly" is a structural claim, not a stylistic one, so this template
 * earns it structurally: a single linear column in reading order, no
 * multi-column layout for a parser to interleave, no tables used for layout, no
 * text carried in decoration, plain h1/h2 headings, and conventional section
 * names ("Work Experience", "Skills") that keyword matchers recognise. The
 * photo is OMITTED entirely — many resume parsers stumble on images, and a
 * template whose selling point is machine-readability should not carry one.
 *
 * That omission is a DESIGN choice about this template, not a privacy rule: the
 * mapper decides what data exists, this decides what this layout shows. No
 * other template drops the photo.
 *
 * Hard rules (identical across every template here):
 * - Everything inline. Chromium fetches NOTHING at render time.
 * - Latin system fonts only; English MVP, no bidi/RTL.
 * - Renders ONLY what the ResumeView carries — the mapper is the omission
 *   chokepoint; there is no `settings` logic here on purpose.
 * - Every interpolated value passes through esc(); profile text is user input.
 * - Video Portfolio renders only when a video exists — never a placeholder.
 */
function detailsSection(view: ResumeViewDto): string {
  const rows = factRows(view);
  if (rows.length === 0) return '';
  // "Label: value" lines rather than a layout table — a parser reads these as
  // sentences; a table it may read column-first and scramble.
  const items = rows
    .map(
      ([label, value]) => `<p class="line"><span class="k">${esc(label)}:</span> ${esc(value)}</p>`,
    )
    .join('\n');
  return `<section>
    <h2>Personal Details</h2>
    ${items}
  </section>`;
}

function experienceSection(view: ResumeViewDto): string {
  if (view.experiences.length === 0) return '';
  const items = view.experiences
    .map((e) => {
      const duration = durationLabel(e.years, e.months);
      const meta = [e.country, duration, e.type === 'FOREIGN' ? 'Overseas experience' : '']
        .filter(Boolean)
        .map(esc)
        .join(' — ');
      return `<div class="job">
        <h3>${esc(e.role)}</h3>
        <p class="co">${esc(e.companyName)}</p>
        ${meta ? `<p class="meta">${meta}</p>` : ''}
      </div>`;
    })
    .join('\n');
  return `<section>
    <h2>Work Experience</h2>
    ${items}
  </section>`;
}

function skillsSection(view: ResumeViewDto): string {
  if (view.skills.length === 0) return '';
  // A comma-separated sentence, not chips: chips are styled spans that some
  // parsers concatenate without separators.
  return `<section>
    <h2>Skills</h2>
    <p>${view.skills.map((s) => esc(s.name)).join(', ')}</p>
  </section>`;
}

function documentsSection(view: ResumeViewDto): string {
  if (view.documents.length === 0) return '';
  const items = view.documents
    .map((d) => {
      const validity =
        d.passportValid === undefined ? '' : d.passportValid ? ' (valid)' : ' (expired)';
      return `${esc(documentLabel(d.type))}${validity}`;
    })
    .join(', ');
  return `<section>
    <h2>Documents</h2>
    <p>${items}</p>
  </section>`;
}

export function renderMinimal(view: ResumeViewDto): string {
  // The photo is intentionally not rendered — see the class docblock. Resolve it
  // anyway so the shared guard stays on the single code path every template uses.
  void safePhotoSrc(view);

  const summary = summaryText(view);
  const video = view.hasVideo
    ? `<section><h2>Video Portfolio</h2><p>A video introduction is available on Skill India Connect.</p></section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  ${pageFrame('22mm 20mm')}
  ${stickyFooterFrame()}
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 10.5pt; color: #222; line-height: 1.6;
  }
  header { margin-bottom: 10mm; }
  h1 { font-size: 19pt; font-weight: 600; letter-spacing: 0.01em; }
  .headline { font-size: 11pt; color: #555; margin-top: 1mm; }
  .contact { font-size: 10pt; color: #555; margin-top: 3mm; }
  h2 {
    font-size: 10pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.12em; color: #222; margin-bottom: 3mm;
  }
  section { margin-bottom: 9mm; }
  .line { font-size: 10pt; }
  .line .k { color: #555; }
  .job { margin-bottom: 5mm; }
  .job h3 { font-size: 11pt; font-weight: 600; }
  .job .co { color: #333; }
  .job .meta { font-size: 9.5pt; color: #777; }
  footer { font-size: 8.5pt; color: #999; }
  .summary { font-size: 10.5pt; line-height: 1.6; color: #444; margin-bottom: 7mm; }
</style>
</head>
<body>
  <header>
    <h1>${esc(view.fullName)}</h1>
    ${view.jobCategory ? `<p class="headline">${esc(view.jobCategory)}</p>` : ''}
    <p class="contact">${contactParts(view).map(esc).join(' | ')}</p>
  </header>

  ${summary ? `<p class="summary">${summary}</p>` : ''}

  <main>
    ${detailsSection(view)}
    ${experienceSection(view)}
    ${skillsSection(view)}
    ${documentsSection(view)}
    ${video}
  </main>

  ${documentFooter(view)}
</body>
</html>`;
}
