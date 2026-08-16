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
 * TIMELINE — the MODERN one. Work history renders as a vertical timeline: a
 * connector rail down the page with a marker beside each role.
 *
 * This is the template that argues a case rather than listing facts. The
 * candidates here are usually selling CONTINUITY of trade experience — four
 * years in Oman, three in the UAE, two at home — and a timeline shows an
 * unbroken run at a glance in a way a bulleted list does not.
 *
 * THE RAIL IS DRAWN PER ITEM, NOT AS ONE LONG LINE. Each entry paints its own
 * left border and its own marker, so the rail is exactly as long as the list.
 * A single absolutely-positioned rail spanning the section would be simpler and
 * is the obvious first attempt — it also outlives its content, leaving a line
 * running down an empty page for a candidate with no experience yet, and
 * breaking across an A4 boundary as a rail with no items beside it.
 *
 * For the same reason the timeline is used ONLY for experience. Applying it to
 * skills or documents would put decoration on blocks that are frequently empty.
 *
 * Hard rules (identical across every template here):
 * - Everything inline; the photo is a data URI. Chromium fetches NOTHING.
 * - Latin system fonts only; English MVP, no bidi/RTL.
 * - Renders ONLY what the ResumeView carries — the mapper is the omission
 *   chokepoint; there is no `settings` logic here on purpose.
 * - Every interpolated value passes through esc(); profile text is user input.
 * - Video Portfolio renders only when a video exists — never a placeholder.
 */
const ACCENT = '#0e7490';
const RAIL = '#cbd5e1';

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
      const where = [e.country, e.type === 'FOREIGN' ? 'Overseas' : '']
        .filter(Boolean)
        .map(esc)
        .join(' &middot; ');
      return `<li>
        <p class="role">${esc(e.role)}</p>
        <p class="co">${esc(e.companyName)}</p>
        <p class="meta">${[where, duration ? esc(duration) : ''].filter(Boolean).join(' &nbsp;|&nbsp; ')}</p>
      </li>`;
    })
    .join('\n');
  return `<section>
    <h2>Work Experience</h2>
    <ul class="rail">${items}</ul>
  </section>`;
}

function skillsSection(view: ResumeViewDto): string {
  if (view.skills.length === 0) return '';
  return `<section>
    <h2>Skills</h2>
    <p class="skills">${view.skills.map((s) => `<span>${esc(s.name)}</span>`).join('')}</p>
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

export function renderTimeline(view: ResumeViewDto): string {
  const src = safePhotoSrc(view);
  const summary = summaryText(view);
  const photo = src ? `<img class="photo" src="${src}" alt="" />` : '';
  const video = view.hasVideo
    ? `<section><h2>Video Portfolio</h2><p>A video introduction is available on Skill India Connect.</p></section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  ${pageFrame('17mm 16mm')}
  ${stickyFooterFrame()}
  body {
    font-family: "Segoe UI", -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 10.5pt; color: #0f172a; line-height: 1.5;
  }

  header {
    display: flex; gap: 6mm; align-items: center;
    background: linear-gradient(90deg, #ecfeff 0%, #ffffff 75%);
    border-left: 3mm solid ${ACCENT};
    border-radius: 0 2.5mm 2.5mm 0;
    padding: 5mm 6mm; margin-bottom: 8mm;
  }
  .photo { width: 25mm; height: 25mm; border-radius: 2mm; object-fit: cover; flex-shrink: 0; }
  .who { flex: 1; }
  h1 { font-size: 22pt; font-weight: 700; letter-spacing: -0.015em; }
  .headline { font-size: 10.5pt; color: ${ACCENT}; font-weight: 600; margin-top: 0.5mm; }
  .contact { font-size: 9.5pt; color: #64748b; margin-top: 2mm; }

  h2 {
    font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.11em;
    color: #334155; font-weight: 700; margin: 0 0 3.5mm;
  }
  section { margin-bottom: 7mm; }

  .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5mm 8mm; }
  .fact { display: flex; gap: 2mm; font-size: 10pt; }
  .fact .k { color: #64748b; min-width: 26mm; }
  .fact .v { font-weight: 600; }

  /* The rail: each item paints its own segment, so the line stops with the
     list. break-inside:avoid keeps a marker attached to its entry across an
     A4 boundary. */
  ul.rail { list-style: none; }
  ul.rail li {
    position: relative; padding-left: 7mm; padding-bottom: 4.5mm;
    border-left: 0.8pt solid ${RAIL}; margin-left: 1.5mm; break-inside: avoid;
  }
  ul.rail li:last-child { border-left-color: transparent; padding-bottom: 0; }
  ul.rail li::before {
    content: ""; position: absolute; left: -1.65mm; top: 1.4mm;
    width: 2.6mm; height: 2.6mm; border-radius: 50%;
    background: #fff; border: 0.9pt solid ${ACCENT};
  }
  ul.rail .role { font-weight: 700; font-size: 11pt; }
  ul.rail .co { color: ${ACCENT}; font-size: 10pt; }
  ul.rail .meta { font-size: 9pt; color: #94a3b8; margin-top: 0.3mm; }

  .skills span {
    display: inline-block; background: #ecfeff; color: #155e75;
    border-radius: 2pt; padding: 1mm 3mm; margin: 0 1.5mm 1.5mm 0; font-size: 9.5pt;
  }
  ul.docs { list-style: none; }
  ul.docs li { font-size: 10pt; padding-left: 4mm; position: relative; margin-bottom: 1mm; }
  ul.docs li::before { content: "\\2013"; color: ${ACCENT}; position: absolute; left: 0; }

  footer { padding-top: 3mm; border-top: 0.5pt solid #e2e8f0; font-size: 8pt; color: #94a3b8; }
  .summary { font-size: 10.5pt; line-height: 1.6; color: #3a4454; margin-bottom: 7mm; }
</style>
</head>
<body>
  <header>
    ${photo}
    <div class="who">
      <h1>${esc(view.fullName)}</h1>
      ${view.jobCategory ? `<p class="headline">${esc(view.jobCategory)}</p>` : ''}
      <p class="contact">${contactParts(view).map(esc).join(' &nbsp;&middot;&nbsp; ')}</p>
    </div>
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
