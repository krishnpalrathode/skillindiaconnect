import { ResumeViewDto } from '../resume-view.mapper';
import {
  contactParts,
  documentLabel,
  durationLabel,
  esc,
  factRows,
  pageFrame,
  safePhotoSrc,
} from './shared';

/**
 * CLASSIC (S7-B1, renamed in B2) — traditional single column, conservative
 * type, clear section rules. The safe choice for formal Gulf employer
 * submissions, and the DEFAULT: it is the template every existing resume was
 * rendered with, so its output must not drift.
 *
 * Hard rules, shared by every template in this directory:
 * - EVERYTHING is inline: styles in a <style> block, the photo as a data URI
 *   supplied by the render service. Chromium never fetches anything at render
 *   time — nothing can hang the load and nothing leaves the machine.
 * - System font stack (Latin only — English MVP). No RTL/bidi, no Devanagari/
 *   Arabic font embedding; the language guard upstream renders EN regardless
 *   of a stray hi/ar setting.
 * - The template renders ONLY what the ResumeView carries — the mapper is the
 *   omission chokepoint; there is no `settings` logic here on purpose. A field
 *   absent from the view simply produces no markup.
 * - All interpolated values pass through esc() — profile text is user input.
 * - The Video Portfolio section renders only when a video exists (Phase 2;
 *   absent at MVP, not an empty placeholder).
 */
function experienceSection(view: ResumeViewDto): string {
  if (view.experiences.length === 0) return '';
  const items = view.experiences
    .map((e) => {
      const duration = durationLabel(e.years, e.months);
      return `<li>
        <p class="role">${esc(e.role)} <span class="co">— ${esc(e.companyName)}</span></p>
        <p class="meta">${esc(e.country)}${duration ? ` &middot; ${esc(duration)}` : ''}${
          e.type === 'FOREIGN' ? ' &middot; Overseas experience' : ''
        }</p>
      </li>`;
    })
    .join('\n');
  return `<section>
    <h2>Work Experience</h2>
    <ul class="exp">${items}</ul>
  </section>`;
}

function skillsSection(view: ResumeViewDto): string {
  if (view.skills.length === 0) return '';
  return `<section>
    <h2>Skills</h2>
    <p class="skills">${view.skills.map((s) => `<span>${esc(s.name)}</span>`).join(' ')}</p>
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

function personalSection(view: ResumeViewDto): string {
  const rows = factRows(view);
  if (rows.length === 0) return '';
  const html = rows
    .map(([label, value]) => `<tr><th scope="row">${esc(label)}</th><td>${esc(value)}</td></tr>`)
    .join('\n');
  return `<section>
    <h2>Personal Details</h2>
    <table class="facts">${html}</table>
  </section>`;
}

export function renderClassic(view: ResumeViewDto): string {
  const src = safePhotoSrc(view);
  const photo = src ? `<img class="photo" src="${src}" alt="" />` : '';
  const video = view.hasVideo
    ? `<section><h2>Video Portfolio</h2><p>A video introduction is available on Skill India Connect.</p></section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  ${pageFrame('16mm 14mm')}
  body {
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 10.5pt; color: #1a202c; line-height: 1.45;
  }
  header { display: flex; gap: 8mm; align-items: flex-start; border-bottom: 2px solid #1d4ed8; padding-bottom: 5mm; margin-bottom: 6mm; }
  .photo { width: 28mm; height: 34mm; object-fit: cover; border: 1px solid #cbd5e1; }
  h1 { font-size: 20pt; color: #1d4ed8; }
  .headline { font-size: 11pt; color: #475569; margin-top: 1mm; }
  .contact { font-size: 9.5pt; color: #475569; margin-top: 2mm; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.06em; color: #1d4ed8; border-bottom: 1px solid #e2e8f0; padding-bottom: 1mm; margin: 5mm 0 2.5mm; }
  table.facts { border-collapse: collapse; width: 100%; }
  table.facts th { text-align: left; font-weight: 600; color: #475569; padding: 0.8mm 6mm 0.8mm 0; white-space: nowrap; vertical-align: top; width: 34mm; }
  table.facts td { padding: 0.8mm 0; }
  ul.exp { list-style: none; }
  ul.exp li { margin-bottom: 2.5mm; }
  ul.exp .role { font-weight: 600; }
  ul.exp .co { font-weight: 400; color: #475569; }
  ul.exp .meta { font-size: 9pt; color: #64748b; }
  .skills span { display: inline-block; border: 1px solid #cbd5e1; border-radius: 3px; padding: 0.5mm 2mm; margin: 0 1mm 1mm 0; font-size: 9.5pt; }
  ul.docs { list-style: disc; padding-left: 5mm; }
  footer { margin-top: 8mm; font-size: 8pt; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 2mm; }
</style>
</head>
<body>
  <header>
    ${photo}
    <div>
      <h1>${esc(view.fullName)}</h1>
      ${view.jobCategory ? `<p class="headline">${esc(view.jobCategory)}</p>` : ''}
      <p class="contact">${contactParts(view).map(esc).join(' &middot; ')}</p>
    </div>
  </header>

  ${personalSection(view)}
  ${experienceSection(view)}
  ${skillsSection(view)}
  ${documentsSection(view)}
  ${video}

  <footer>Generated by Skill India Connect &middot; ${esc(view.generatedAt.slice(0, 10))}</footer>
</body>
</html>`;
}
