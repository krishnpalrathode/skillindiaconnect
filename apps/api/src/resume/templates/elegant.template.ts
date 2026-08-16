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
 * ELEGANT — the DECORATIVE one. A centred serif title page treatment with
 * ornamental rules, small-caps section headings and generous leading.
 *
 * Why a serif at all, when the other five are sans: the Gulf corridor still
 * runs on printed paper. A candidate's CV is photocopied, stapled to a file and
 * handed across a desk, and a formal serif reads as "official document" to that
 * audience in a way a geometric sans does not. This is the template for someone
 * who wants their resume to look like a certificate.
 *
 * THE DECORATION IS STRUCTURAL, NOT SPRINKLED. Every ornament here is attached
 * to something that always exists — the name rule under the header, and the
 * flanking rules on each section heading. Nothing decorative hangs off an
 * OPTIONAL field, which is the trap with this style: a flourish tied to, say,
 * the skills block leaves a stray ornament floating when a candidate has no
 * skills yet. Sparse profiles get fewer headings, never orphaned decoration.
 *
 * Hard rules (identical across every template here):
 * - Everything inline; the photo is a data URI. Chromium fetches NOTHING.
 * - Latin system fonts only; English MVP, no bidi/RTL.
 * - Renders ONLY what the ResumeView carries — the mapper is the omission
 *   chokepoint; there is no `settings` logic here on purpose.
 * - Every interpolated value passes through esc(); profile text is user input.
 * - Video Portfolio renders only when a video exists — never a placeholder.
 */
const INK = '#1c2a3a';
const GOLD = '#a67c2e';

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
    <h2><span>Personal Details</span></h2>
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
      return `<article class="job">
        <p class="role">${esc(e.role)}</p>
        <p class="co">${esc(e.companyName)}</p>
        ${meta ? `<p class="meta">${meta}</p>` : ''}
      </article>`;
    })
    .join('\n');
  return `<section>
    <h2><span>Work Experience</span></h2>
    ${items}
  </section>`;
}

function skillsSection(view: ResumeViewDto): string {
  if (view.skills.length === 0) return '';
  const items = view.skills.map((s) => esc(s.name)).join(' &nbsp;&bull;&nbsp; ');
  return `<section>
    <h2><span>Skills</span></h2>
    <p class="skills">${items}</p>
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
    <h2><span>Documents</span></h2>
    <ul class="docs">${items}</ul>
  </section>`;
}

export function renderElegant(view: ResumeViewDto): string {
  const src = safePhotoSrc(view);
  const summary = summaryText(view);
  const photo = src ? `<img class="photo" src="${src}" alt="" />` : '';
  const video = view.hasVideo
    ? `<section><h2><span>Video Portfolio</span></h2><p>A video introduction is available on Skill India Connect.</p></section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  ${pageFrame('19mm 18mm')}
  ${stickyFooterFrame()}
  body {
    font-family: Georgia, "Times New Roman", "Nimbus Roman", serif;
    font-size: 10.5pt; color: ${INK}; line-height: 1.62;
  }

  header { text-align: center; margin-bottom: 8mm; }
  .photo {
    width: 24mm; height: 24mm; border-radius: 50%; object-fit: cover;
    border: 0.8pt solid ${GOLD}; padding: 1mm; margin-bottom: 3mm;
  }
  h1 {
    font-size: 24pt; font-weight: 400; letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .headline {
    font-size: 10.5pt; letter-spacing: 0.18em; text-transform: uppercase;
    color: ${GOLD}; margin-top: 1.5mm;
  }
  /* The one fixed ornament: a double rule under the name, which every resume
     has. Tied to the header so it can never be orphaned. */
  .rule { border-top: 1.2pt solid ${GOLD}; border-bottom: 0.4pt solid ${GOLD};
          height: 1.4mm; width: 34mm; margin: 3.5mm auto 0; }
  .contact { font-size: 9.5pt; color: #52606d; margin-top: 3mm; font-style: italic; }

  /* Section headings are centred small-caps flanked by hairlines. Built with
     flex + pseudo-elements so the rules stretch to fill whatever the heading
     leaves — no fixed widths to go wrong at different heading lengths. */
  h2 { display: flex; align-items: center; gap: 3mm; margin: 0 0 3.5mm; }
  h2 span {
    font-size: 9.5pt; font-weight: 700; letter-spacing: 0.2em;
    text-transform: uppercase; color: ${INK}; white-space: nowrap;
  }
  h2::before, h2::after { content: ""; flex: 1; border-top: 0.5pt solid #d8cbb2; }

  section { margin-bottom: 7mm; }
  .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 1.4mm 8mm; }
  .fact { font-size: 10pt; }
  .fact .k { color: #6b7683; font-style: italic; }
  .fact .k::after { content: " — "; }

  .job { margin-bottom: 4.5mm; text-align: center; }
  .job .role { font-size: 11.5pt; font-weight: 700; }
  .job .co { font-size: 10.5pt; color: ${GOLD}; font-style: italic; }
  .job .meta { font-size: 9pt; color: #7b8794; }

  .skills { text-align: center; font-size: 10pt; }
  ul.docs { list-style: none; text-align: center; }
  ul.docs li { font-size: 10pt; margin-bottom: 1mm; }

  footer { padding-top: 3mm; border-top: 0.5pt solid #d8cbb2;
           font-size: 8pt; color: #98a2b3; text-align: center; font-style: italic; }
  .summary { font-size: 11pt; line-height: 1.65; color: #3f3a34; font-style: italic; text-align: center; margin: 0 auto 7mm; max-width: 150mm; }
</style>
</head>
<body>
  <header>
    ${photo}
    <h1>${esc(view.fullName)}</h1>
    ${view.jobCategory ? `<p class="headline">${esc(view.jobCategory)}</p>` : ''}
    <div class="rule"></div>
    <p class="contact">${contactParts(view).map(esc).join(' &nbsp;&middot;&nbsp; ')}</p>
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
