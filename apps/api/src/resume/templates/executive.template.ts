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
  watermarkFrame,
  watermarkLayer,
} from './shared';

/**
 * EXECUTIVE — the BOLD one. A full-bleed colour header band carrying the name,
 * headline, photo and contact line, then quiet single-column content beneath.
 *
 * The band is the whole idea: it survives being photocopied, faxed and scanned,
 * which is the actual journey these documents take through a Gulf agency, and
 * it makes the candidate's name the first thing found in a stack of paper.
 *
 * FULL-BLEED NEEDS THE PAGE MARGIN AT ZERO. `@page` margin is 0 here and every
 * inner block supplies its own padding instead — that is the only way a colour
 * band can reach the paper edge, since content cannot paint into the page
 * margin. The consequence is that padding is load-bearing rather than
 * decorative: remove it and text sits on the trim line.
 *
 * The band prints because the renderer runs with `printBackground: true`
 * (browser-pool.service.ts). Without that flag this template would render as a
 * white rectangle with white text — the one hard dependency it has on the
 * generation options.
 *
 * Hard rules (identical across every template here):
 * - Everything inline; the photo is a data URI. Chromium fetches NOTHING.
 * - Latin system fonts only; English MVP, no bidi/RTL.
 * - Renders ONLY what the ResumeView carries — the mapper is the omission
 *   chokepoint; there is no `settings` logic here on purpose.
 * - Every interpolated value passes through esc(); profile text is user input.
 * - Video Portfolio renders only when a video exists — never a placeholder.
 */
const BAND = '#0f3d91';
const ACCENT = '#f57c20';

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
        <div class="head">
          <p class="role">${esc(e.role)}</p>
          ${duration ? `<span class="dur">${esc(duration)}</span>` : ''}
        </div>
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

export function renderExecutive(view: ResumeViewDto): string {
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
  ${pageFrame('0')}
  ${watermarkFrame()}
  ${stickyFooterFrame()}
  body {
    font-family: "Segoe UI", -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 10.5pt; color: #1f2933; line-height: 1.5;
  }

  /* Full-bleed band. Reaches the paper edge only because @page margin is 0. */
  .band {
    background: ${BAND}; color: #fff;
    padding: 13mm 16mm 11mm;
    border-bottom: 2.5mm solid ${ACCENT};
    display: flex; gap: 7mm; align-items: center;
  }
  .photo {
    width: 27mm; height: 27mm; border-radius: 50%; object-fit: cover;
    border: 1mm solid rgba(255,255,255,0.85); flex-shrink: 0;
  }
  .who { flex: 1; }
  h1 { font-size: 25pt; font-weight: 700; letter-spacing: -0.015em; }
  .headline {
    font-size: 10.5pt; letter-spacing: 0.14em; text-transform: uppercase;
    color: #ffd8b5; font-weight: 600; margin-top: 1mm;
  }
  .contact { font-size: 9.5pt; color: rgba(255,255,255,0.88); margin-top: 3mm; }

  /* Every block below the band supplies the side padding the page margin no
     longer provides. */
  main { padding: 9mm 16mm 0; }
  h2 {
    font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.12em;
    color: ${BAND}; font-weight: 700; margin: 0 0 3mm;
    padding-bottom: 1.5mm; border-bottom: 1.5pt solid #e4e7eb;
  }
  section { margin-bottom: 7mm; }

  .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5mm 8mm; }
  .fact { display: flex; gap: 2mm; font-size: 10pt; }
  .fact .k { color: #7b8794; min-width: 26mm; }
  .fact .v { font-weight: 600; }

  ul.exp { list-style: none; }
  ul.exp li { margin-bottom: 4.5mm; }
  ul.exp .head { display: flex; align-items: baseline; gap: 3mm; }
  ul.exp .role { font-weight: 700; font-size: 11.5pt; flex: 1; }
  ul.exp .dur {
    font-size: 8.5pt; font-weight: 700; color: ${BAND};
    background: #eaf0fb; border-radius: 8pt; padding: 0.6mm 2.6mm; white-space: nowrap;
  }
  ul.exp .co { color: #3e4c59; font-size: 10.5pt; }
  ul.exp .meta { font-size: 9pt; color: #9aa5b1; }

  .skills span {
    display: inline-block; border: 0.8pt solid ${BAND}; color: ${BAND};
    border-radius: 2pt; padding: 0.8mm 2.8mm; margin: 0 1.5mm 1.5mm 0; font-size: 9.5pt;
    font-weight: 600;
  }
  ul.docs { list-style: none; }
  ul.docs li { font-size: 10pt; padding-left: 4mm; position: relative; margin-bottom: 1mm; }
  ul.docs li::before { content: "\\25AA"; color: ${ACCENT}; position: absolute; left: 0; }

  footer {
    padding: 3mm 16mm 8mm; font-size: 8pt; color: #9aa5b1;
  }
  .summary { font-size: 10.5pt; line-height: 1.6; color: #33415a; margin-bottom: 7mm; }
</style>
</head>
<body>
  ${watermarkLayer()}
  <header class="band">
    ${photo}
    <div class="who">
      <h1>${esc(view.fullName)}</h1>
      ${view.jobCategory ? `<p class="headline">${esc(view.jobCategory)}</p>` : ''}
      <p class="contact">${contactParts(view).map(esc).join(' &nbsp;&middot;&nbsp; ')}</p>
    </div>
  </header>

  <main>
    ${
      /* Inside <main>, unlike the other templates: the page margin is 0 here and
          every block supplies its own side padding, so a summary outside <main>
          would sit flush against the paper edge. */ ''
    }
    ${summary ? `<p class="summary">${summary}</p>` : ''}
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
