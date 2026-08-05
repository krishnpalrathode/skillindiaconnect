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
 * MODERN (CR-001 B2) — clean single column, ONE accent colour, generous
 * whitespace, contemporary sans-serif. The template most candidates should
 * pick, and the one the F2 picker badges "Recommended".
 *
 * How it differs from CLASSIC, deliberately: no boxed table of facts and no
 * ruled section underlines. Sections are separated by space and a small accent
 * marker rather than by lines, which reads as contemporary and — the practical
 * benefit — degrades far better on a sparse profile, because absent sections
 * leave whitespace instead of a stack of empty ruled headings.
 *
 * Hard rules (identical across every template here):
 * - Everything inline; the photo is a data URI. Chromium fetches NOTHING.
 * - Latin system fonts only; English MVP, no bidi/RTL.
 * - Renders ONLY what the ResumeView carries — the mapper is the omission
 *   chokepoint; there is no `settings` logic here on purpose. A field absent
 *   from the view produces no markup, so a hidden field cannot reach the bytes.
 * - Every interpolated value passes through esc(); profile text is user input.
 * - Video Portfolio renders only when a video exists — never a placeholder.
 */
const ACCENT = '#0f766e';

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
      return `<li>
        <p class="role">${esc(e.role)}</p>
        <p class="co">${esc(e.companyName)}</p>
        ${meta ? `<p class="meta">${meta}</p>` : ''}
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

export function renderModern(view: ResumeViewDto): string {
  const src = safePhotoSrc(view);
  const photo = src ? `<img class="photo" src="${src}" alt="" />` : '';
  const video = view.hasVideo
    ? `<section><h2>Video Portfolio</h2><p>A video introduction is available on SkillIndiaConnect.</p></section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  ${pageFrame('18mm 16mm')}
  body {
    font-family: "Segoe UI", -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 10.5pt; color: #111827; line-height: 1.55;
  }
  header { display: flex; gap: 7mm; align-items: center; margin-bottom: 9mm; }
  .photo { width: 26mm; height: 26mm; border-radius: 50%; object-fit: cover; }
  .who { flex: 1; }
  h1 { font-size: 23pt; font-weight: 600; letter-spacing: -0.01em; }
  .headline { font-size: 11pt; color: ${ACCENT}; font-weight: 600; margin-top: 0.5mm; }
  .contact { font-size: 9.5pt; color: #6b7280; margin-top: 2mm; }
  /* An accent marker instead of a rule — the section separator that does not
     leave a stack of empty lines when a sparse profile drops sections. */
  h2 {
    font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.10em;
    color: #374151; font-weight: 700; margin: 0 0 3mm;
    padding-left: 3.5mm; border-left: 2.5pt solid ${ACCENT};
  }
  section { margin-bottom: 7mm; }
  .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5mm 8mm; }
  .fact { display: flex; gap: 2mm; font-size: 10pt; }
  .fact .k { color: #6b7280; min-width: 26mm; }
  .fact .v { font-weight: 500; }
  ul.exp { list-style: none; }
  ul.exp li { margin-bottom: 4.5mm; padding-left: 3.5mm; border-left: 1pt solid #e5e7eb; }
  ul.exp .role { font-weight: 600; font-size: 11pt; }
  ul.exp .co { color: ${ACCENT}; font-size: 10pt; }
  ul.exp .meta { font-size: 9pt; color: #9ca3af; margin-top: 0.5mm; }
  .skills span {
    display: inline-block; background: #f0fdfa; color: #115e59;
    border-radius: 10pt; padding: 1mm 3mm; margin: 0 1.5mm 1.5mm 0; font-size: 9.5pt;
  }
  ul.docs { list-style: none; }
  ul.docs li { font-size: 10pt; padding-left: 4mm; position: relative; margin-bottom: 1mm; }
  ul.docs li::before { content: "•"; color: ${ACCENT}; position: absolute; left: 0; }
  footer { margin-top: 4mm; font-size: 8pt; color: #9ca3af; }
</style>
</head>
<body>
  <header>
    ${photo}
    <div class="who">
      <h1>${esc(view.fullName)}</h1>
      ${view.jobCategory ? `<p class="headline">${esc(view.jobCategory)}</p>` : ''}
      <p class="contact">${contactParts(view).map(esc).join(' &nbsp;·&nbsp; ')}</p>
    </div>
  </header>

  ${detailsSection(view)}
  ${experienceSection(view)}
  ${skillsSection(view)}
  ${documentsSection(view)}
  ${video}

  <footer>Generated by SkillIndiaConnect &middot; ${esc(view.generatedAt.slice(0, 10))}</footer>
</body>
</html>`;
}
