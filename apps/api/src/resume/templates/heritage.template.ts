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
 * HERITAGE — the second CLASSIC-family template.
 *
 * A printed-document look: serif throughout, no colour at all, a double rule
 * under the name, and small-caps section headings sitting on a hairline. It is
 * the template for the candidate whose file will be printed, stamped and put in
 * a folder by an agency — which is still most of this corridor.
 *
 * NO COLOUR IS THE POINT. Every other template here spends at least one accent
 * hue, and colour is the first thing a fax, a photocopier or a cheap mono laser
 * throws away. Designing monochrome from the start means the printed artifact is
 * the intended artifact rather than a degraded copy of it.
 *
 * HOW IT DIFFERS from the two it could be confused with:
 *  - CLASSIC: sans-serif, blue rules, facts in a table. HERITAGE is serif,
 *    monochrome, and sets its facts as a definition grid.
 *  - ELEGANT: also serif, but centred, gold-ruled and italic — a decorative
 *    treatment. HERITAGE is flush left and severe; nothing is centred.
 *
 * Hard rules (identical across every template here):
 * - Everything inline; Chromium fetches NOTHING at render time.
 * - Latin system fonts only; English MVP, no bidi/RTL.
 * - Renders ONLY what the ResumeView carries — the mapper is the omission
 *   chokepoint; there is no `settings` logic here on purpose.
 * - Every interpolated value passes through esc(); profile text is user input.
 * - Video Portfolio renders only when a video exists — never a placeholder.
 */
const INK = '#1a1a1a';
const RULE = '#8a8a8a';

function detailsSection(view: ResumeViewDto): string {
  const rows = factRows(view);
  if (rows.length === 0) return '';
  const items = rows
    .map(
      ([label, value]) =>
        `<div class="fact"><span class="k">${esc(label)}</span><span class="v">${esc(value)}</span></div>`,
    )
    .join('\n');
  return `<section>
    <h2>Personal Details</h2>
    <div class="facts">${items}</div>
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
        .join(' &middot; ');
      return `<div class="job">
        <p class="jobrole">${esc(e.role)}</p>
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
  // A rule-separated sentence, not chips: chips are a screen device and print
  // as grey boxes on the mono lasers this template is aimed at.
  return `<section>
    <h2>Skills</h2>
    <p class="skills">${view.skills.map((s) => esc(s.name)).join(' &nbsp;|&nbsp; ')}</p>
  </section>`;
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
  return `<section>
    <h2>Documents</h2>
    <ul class="docs">${items}</ul>
  </section>`;
}

export function renderHeritage(view: ResumeViewDto): string {
  // Deliberately no photo: a photograph is the one element that reproduces worst
  // on the mono print path this template is designed around. Resolved anyway so
  // the shared data-URI guard stays on the single code path.
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
    font-family: "Times New Roman", Times, Georgia, serif;
    font-size: 11pt; color: ${INK}; line-height: 1.55;
  }

  /* The double rule: one heavy, one hairline. The oldest letterhead device
     there is, and it survives a photocopier where a tint never would. */
  header {
    border-bottom: 2.2pt solid ${INK};
    padding-bottom: 1.2mm; margin-bottom: 0.9mm;
  }
  .rule-thin { border-bottom: 0.5pt solid ${INK}; margin-bottom: 7mm; }

  h1 {
    font-size: 21pt; font-weight: 700; letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .headline {
    font-size: 10.5pt; font-variant: small-caps; letter-spacing: 0.09em;
    color: #3a3a3a; margin-top: 1mm;
  }
  .contact { font-size: 10pt; color: #3a3a3a; margin-top: 2mm; }

  h2 {
    font-size: 10.5pt; font-variant: small-caps; font-weight: 700;
    letter-spacing: 0.13em; border-bottom: 0.5pt solid ${RULE};
    padding-bottom: 1mm; margin-bottom: 3mm;
  }
  section { margin-bottom: 7mm; }

  .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2mm 10mm; }
  .fact { display: flex; gap: 2mm; font-size: 10.5pt; }
  .fact .k { min-width: 30mm; color: #4a4a4a; }
  .fact .v { font-weight: 700; }

  .job { margin-bottom: 4.5mm; }
  .jobrole { font-size: 11.5pt; font-weight: 700; }
  /* Italic company name — the standard print convention for an employer. */
  .co { font-style: italic; }
  .meta { font-size: 9.5pt; color: #555; }

  .skills { font-size: 10.5pt; }
  ul.docs { list-style: none; font-size: 10.5pt; }
  ul.docs li { padding-left: 4mm; position: relative; margin-bottom: 0.8mm; }
  ul.docs li::before { content: "\\2022"; position: absolute; left: 0; }

  .summary { font-size: 11pt; line-height: 1.6; margin-bottom: 6mm; }
  footer {
    padding-top: 2.5mm; border-top: 0.5pt solid ${RULE};
    font-size: 8.5pt; color: #666;
  }
</style>
</head>
<body>
  <header>
    <h1>${esc(view.fullName)}</h1>
    ${view.jobCategory ? `<p class="headline">${esc(view.jobCategory)}</p>` : ''}
    <p class="contact">${contactParts(view).map(esc).join(' &nbsp;&middot;&nbsp; ')}</p>
  </header>
  <div class="rule-thin"></div>

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
