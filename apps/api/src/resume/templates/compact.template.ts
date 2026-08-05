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
 * COMPACT (CR-001 B2) — two columns: a sidebar for the short facts (contact,
 * personal details, skills, documents) and a main column for work experience.
 * Fits more on one page, so it suits candidates with several roles.
 *
 * THE SPARSE-PROFILE PROBLEM, and how this template answers it:
 *
 * Two columns are the layout most likely to look BROKEN when a profile is
 * thin — and thin profiles are the common case here, not the edge case. An
 * empty sidebar beside a populated main column reads as a rendering fault
 * rather than as a design.
 *
 * So the sidebar holds CONTACT, which every resume has (the email is
 * mandatory), guaranteeing it is never empty. Its sections stack from the top
 * and the column is sized by content rather than stretched to the page, so a
 * short sidebar simply ends — it does not leave a long empty tinted panel. The
 * tint is deliberately faint for the same reason: a strong block of colour
 * makes emptiness loud.
 *
 * Hard rules (identical across every template here):
 * - Everything inline; the photo is a data URI. Chromium fetches NOTHING.
 * - Latin system fonts only; English MVP, no bidi/RTL.
 * - Renders ONLY what the ResumeView carries — the mapper is the omission
 *   chokepoint; there is no `settings` logic here on purpose.
 * - Every interpolated value passes through esc(); profile text is user input.
 * - Video Portfolio renders only when a video exists — never a placeholder.
 */
const ACCENT = '#3730a3';

function sidebarBlock(title: string, body: string): string {
  return body ? `<section><h2>${esc(title)}</h2>${body}</section>` : '';
}

function contactBlock(view: ResumeViewDto): string {
  // Always non-empty: the email is mandatory on every profile. This is what
  // keeps the sidebar from ever rendering as a blank column.
  const items = contactParts(view)
    .map((p) => `<li>${esc(p)}</li>`)
    .join('\n');
  return sidebarBlock('Contact', `<ul class="plain">${items}</ul>`);
}

function detailsBlock(view: ResumeViewDto): string {
  const rows = factRows(view);
  if (rows.length === 0) return '';
  const items = rows
    .map(([label, value]) => `<li><span class="k">${esc(label)}</span>${esc(value)}</li>`)
    .join('\n');
  return sidebarBlock('Details', `<ul class="kv">${items}</ul>`);
}

function skillsBlock(view: ResumeViewDto): string {
  if (view.skills.length === 0) return '';
  const items = view.skills.map((s) => `<li>${esc(s.name)}</li>`).join('\n');
  return sidebarBlock('Skills', `<ul class="plain">${items}</ul>`);
}

function documentsBlock(view: ResumeViewDto): string {
  if (view.documents.length === 0) return '';
  const items = view.documents
    .map((d) => {
      const validity =
        d.passportValid === undefined ? '' : d.passportValid ? ' (valid)' : ' (expired)';
      return `<li>${esc(documentLabel(d.type))}${validity}</li>`;
    })
    .join('\n');
  return sidebarBlock('Documents', `<ul class="plain">${items}</ul>`);
}

function experienceSection(view: ResumeViewDto): string {
  if (view.experiences.length === 0) return '';
  const items = view.experiences
    .map((e) => {
      const duration = durationLabel(e.years, e.months);
      const meta = [e.country, duration, e.type === 'FOREIGN' ? 'Overseas' : '']
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

export function renderCompact(view: ResumeViewDto): string {
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
  ${pageFrame('14mm 12mm')}
  body {
    font-family: "Segoe UI", -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 10pt; color: #1f2937; line-height: 1.45;
  }
  header { display: flex; gap: 6mm; align-items: center; border-bottom: 2.5pt solid ${ACCENT}; padding-bottom: 4mm; margin-bottom: 6mm; }
  .photo { width: 24mm; height: 29mm; object-fit: cover; border-radius: 2mm; }
  h1 { font-size: 21pt; font-weight: 600; color: ${ACCENT}; }
  .headline { font-size: 10.5pt; color: #4b5563; margin-top: 0.5mm; }

  .cols { display: grid; grid-template-columns: 56mm 1fr; gap: 8mm; align-items: start; }

  /* align-items:start above + no height here: the sidebar is sized by its
     CONTENT, so a short one ends rather than leaving a tall empty panel. */
  .side { background: #f5f3ff; border-radius: 2mm; padding: 4mm; }
  .side section { margin-bottom: 4mm; }
  .side section:last-child { margin-bottom: 0; }
  .side h2 { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: ${ACCENT}; font-weight: 700; margin-bottom: 1.5mm; }
  ul.plain { list-style: none; }
  ul.plain li { font-size: 9.5pt; margin-bottom: 1mm; }
  ul.kv { list-style: none; }
  ul.kv li { font-size: 9.5pt; margin-bottom: 1.2mm; }
  ul.kv .k { display: block; color: #6b7280; font-size: 8.5pt; }

  .main h2 { font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: ${ACCENT}; font-weight: 700; border-bottom: 1pt solid #e5e7eb; padding-bottom: 1mm; margin-bottom: 3mm; }
  .main section { margin-bottom: 6mm; }
  ul.exp { list-style: none; }
  ul.exp li { margin-bottom: 4mm; }
  ul.exp .role { font-weight: 600; font-size: 10.5pt; }
  ul.exp .co { color: #4b5563; }
  ul.exp .meta { font-size: 8.5pt; color: #9ca3af; margin-top: 0.5mm; }
  footer { margin-top: 6mm; font-size: 8pt; color: #9ca3af; border-top: 1pt solid #e5e7eb; padding-top: 2mm; }
</style>
</head>
<body>
  <header>
    ${photo}
    <div>
      <h1>${esc(view.fullName)}</h1>
      ${view.jobCategory ? `<p class="headline">${esc(view.jobCategory)}</p>` : ''}
    </div>
  </header>

  <div class="cols">
    <aside class="side">
      ${contactBlock(view)}
      ${detailsBlock(view)}
      ${skillsBlock(view)}
      ${documentsBlock(view)}
    </aside>
    <div class="main">
      ${experienceSection(view)}
      ${video}
    </div>
  </div>

  <footer>Generated by SkillIndiaConnect &middot; ${esc(view.generatedAt.slice(0, 10))}</footer>
</body>
</html>`;
}
