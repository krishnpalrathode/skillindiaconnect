import { ResumeViewDto } from '../resume-view.mapper';
import {
  contactParts,
  documentLabel,
  durationLabel,
  esc,
  factRows,
  safePhotoSrc,
  summaryText,
  watermarkFrame,
  watermarkLayer,
} from './shared';

/**
 * The shared skeleton for the SIDEBAR design family (the six replaced templates).
 *
 * ── Why this one is shared, when shared.ts says visuals should not be ──────
 * shared.ts warns that sharing anything visual makes templates stop being
 * distinct. That rule earned its place when the templates were genuinely
 * different documents. These six are not: they are one supplied design in six
 * colourways, differing in accent, sidebar tint, photo shape and header
 * treatment. Six hand-copied 200-line files that must stay in step is the
 * drift-generator that rule was written to prevent — so the STRUCTURE lives
 * here once and each template supplies only its theme.
 *
 * ── What is deliberately NOT rendered ─────────────────────────────────────
 * The supplied designs show Education, Certifications, Tools & Technologies,
 * Key Strengths, per-skill proficiency meters, language levels and per-job
 * bullet points. NONE of those exist on the candidate profile — there is no
 * field to read and no screen that collects them. They are omitted rather than
 * faked: a resume with an invented "AWS Welding Certificate" on it is worse
 * than one without the section.
 *
 * Skills and languages therefore render as plain chips, not as dot meters —
 * a meter with no stored rating would be a picture of a number we do not have.
 *
 * Hard rules (identical across every template here):
 * - Everything inline; Chromium fetches NOTHING at render time.
 * - Latin system fonts only; English MVP, no bidi/RTL.
 * - Renders ONLY what the ResumeView carries — the mapper is the omission
 *   chokepoint; there is no `settings` logic here on purpose.
 * - Every interpolated value passes through esc(); profile text is user input.
 * - Video Portfolio renders only when a video exists — never a placeholder.
 */
export interface SidebarTheme {
  /** Full-bleed sidebar background. */
  sidebar: string;
  /** The single accent used for rules, bullets and the name's second word. */
  accent: string;
  /** Body text colour in the main column. */
  ink: string;
  /** Photo frame: a circle reads friendlier, a rounded square more formal. */
  photo: 'circle' | 'rounded';
  /**
   * `band` moves the identity into a full-width top bar and drops the sidebar
   * to a narrow accent rail — the one structural variant in the family.
   */
  layout: 'sidebar' | 'band';
}

/** Section heading inside the coloured sidebar. */
function sideHeading(text: string): string {
  return `<h2 class="sh">${esc(text)}</h2>`;
}

/** Section heading in the white main column, with its accent underline. */
function mainHeading(text: string): string {
  return `<h2 class="mh">${esc(text)}</h2>`;
}

type Heading = (text: string) => string;

/**
 * Reach-me-here only — email, phone, location.
 *
 * Date of birth deliberately does NOT appear here: Additional Information
 * already carries it, and a date printed twice on one page reads as a
 * template fault. `contactParts` is the shared filter, so a field the mapper
 * withheld for privacy is absent rather than blank.
 */
function contactBlock(view: ResumeViewDto, h: Heading): string {
  const rows = contactParts(view).map((v) => `<li>${esc(v)}</li>`);
  return `<section>${h('Contact')}<ul class="plain">${rows.join('')}</ul></section>`;
}

/**
 * The candidate's own intro, in the sidebar.
 *
 * The designs label this "Profile Summary" and fill it with prose. Ours is the
 * `summary` field — the only free text the profile actually stores — so the
 * block simply disappears for a candidate who has not written one.
 */
function profileBlock(view: ResumeViewDto, h: Heading): string {
  const summary = summaryText(view);
  if (!summary) return '';
  return `<section>${h('Profile')}<p class="profile">${summary}</p></section>`;
}

function skillsBlock(view: ResumeViewDto, h: Heading): string {
  if (view.skills.length === 0) return '';
  const items = view.skills.map((s) => `<li>${esc(s.name)}</li>`).join('');
  return `<section>${h('Skills')}<ul class="chips">${items}</ul></section>`;
}

function languagesBlock(view: ResumeViewDto, h: Heading): string {
  if (view.languages.length === 0) return '';
  const items = view.languages.map((l) => `<li>${esc(l)}</li>`).join('');
  return `<section>${h('Languages')}<ul class="chips">${items}</ul></section>`;
}

function documentsBlock(view: ResumeViewDto, h: Heading): string {
  if (view.documents.length === 0) return '';
  const items = view.documents
    .map((d) => {
      const validity =
        d.passportValid === undefined ? '' : d.passportValid ? ' (valid)' : ' (expired)';
      return `<li>${esc(documentLabel(d.type))}${validity}</li>`;
    })
    .join('');
  return `<section>${h('Documents')}<ul class="plain">${items}</ul></section>`;
}

/**
 * Work history as the designs draw it: a rule down the start edge with a dot
 * per role, the duration pushed to the far end of the row.
 *
 * There are no bullet points under each role because the profile stores none —
 * only role, employer, country and duration.
 */
function experienceSection(view: ResumeViewDto): string {
  if (view.experiences.length === 0) return '';
  const items = view.experiences
    .map((e) => {
      const duration = durationLabel(e.years, e.months);
      const meta = [e.companyName, e.country].filter(Boolean).map(esc).join(', ');
      return `<li>
        <div class="row">
          <p class="role">${esc(e.role)}</p>
          ${duration ? `<span class="dur">${esc(duration)}</span>` : ''}
        </div>
        ${meta ? `<p class="co">${meta}</p>` : ''}
        ${e.type === 'FOREIGN' ? '<p class="tag">Overseas experience</p>' : ''}
      </li>`;
    })
    .join('');
  return `<section>${mainHeading('Work Experience')}<ul class="exp">${items}</ul></section>`;
}

/**
 * The "Additional Information" strip along the foot of the main column.
 *
 * Uses `factRows`, so anything the mapper withheld for privacy is already gone
 * and no template can reinstate it.
 */
function additionalInfo(view: ResumeViewDto): string {
  const rows = factRows(view).filter(([label]) => label !== 'Languages');
  if (rows.length === 0) return '';
  const items = rows
    .map(
      ([label, value]) =>
        `<div class="ai"><span class="k">${esc(label)}</span><span class="v">${esc(value)}</span></div>`,
    )
    .join('');
  return `<section>${mainHeading('Additional Information')}<div class="aigrid">${items}</div></section>`;
}

/** Split the name so the surname can take the accent, as every design does. */
function splitName(fullName: string): { first: string; rest: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return { first: fullName, rest: '' };
  return { first: parts.slice(0, -1).join(' '), rest: parts[parts.length - 1]! };
}

export function renderSidebarResume(view: ResumeViewDto, theme: SidebarTheme): string {
  const src = safePhotoSrc(view);
  const { first, rest } = splitName(view.fullName);
  const band = theme.layout === 'band';

  const photo = src
    ? `<img class="photo" src="${src}" alt="" />`
    : // No photo on file: the frame is dropped entirely rather than left as an
      // empty grey box, which reads as a failed image load.
      '';

  const video = view.hasVideo
    ? `<section>${mainHeading('Video Portfolio')}<p class="vid">A video introduction is available on Skill India Connect.</p></section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  /* Full-bleed: the coloured sidebar must reach the paper edge, and content
     cannot paint into the @page margin — so the margin is 0 and every block
     supplies its own padding. Same technique EXECUTIVE uses. */
  @page { size: A4; margin: 0; }
  ${watermarkFrame()}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  section { break-inside: auto; }
  li { break-inside: avoid; }
  h1, h2 { break-after: avoid; }
  img { max-width: 100%; }
  body { overflow-wrap: anywhere; word-break: normal; }

  html, body { height: 100%; }
  /*
    GRID, not nested flex boxes, so the sidebar, the main column and the
    provenance line are SIBLINGS of the body element, with the provenance line
    last in the document — it has to be the final thing on the page, and the
    sidebar still has to run full height beside it. A wrapper div around the
    last two would satisfy the layout but bury the provenance line inside it.

    (Written without literal tag names on purpose: footer-placement.spec.ts
    locates the real element by scanning the source, and a tag name in a comment
    is indistinguishable from the markup it is looking for.)
  */
  body {
    font-family: "Segoe UI", -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 9.5pt; color: ${theme.ink}; line-height: 1.45;
    display: grid; min-height: 100%;
    ${
      band
        ? 'grid-template-columns: 1fr; grid-template-rows: auto 1fr auto;'
        : 'grid-template-columns: 62mm 1fr; grid-template-rows: 1fr auto;'
    }
  }

  /* ── Sidebar ─────────────────────────────────────────────────────────── */
  .side {
    ${band ? '' : 'grid-row: 1 / -1; grid-column: 1;'}
    background: ${theme.sidebar}; color: #fff;
    ${band ? 'padding: 6mm 14mm;' : 'width: 62mm; flex: 0 0 62mm; padding: 12mm 8mm;'}
    ${band ? 'display: flex; align-items: center; gap: 8mm;' : ''}
  }
  .photo {
    display: block; width: 34mm; height: 34mm; object-fit: cover;
    border: 1mm solid rgba(255,255,255,0.9);
    ${theme.photo === 'circle' ? 'border-radius: 50%;' : 'border-radius: 3mm;'}
    ${band ? '' : 'margin: 0 auto 7mm;'}
  }
  .side section { margin-bottom: 6mm; }
  .side section:last-child { margin-bottom: 0; }
  .sh {
    font-size: 8.5pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.12em; color: #fff; margin-bottom: 2.5mm;
    padding-bottom: 1.2mm; border-bottom: 0.6pt solid rgba(255,255,255,0.35);
  }
  ul.plain { list-style: none; }
  ul.plain li { font-size: 9pt; margin-bottom: 1.4mm; color: rgba(255,255,255,0.92); }
  ul.chips { list-style: none; display: flex; flex-wrap: wrap; gap: 1.2mm; }
  ul.chips li {
    font-size: 8.5pt; background: rgba(255,255,255,0.14);
    border-radius: 1.2mm; padding: 0.8mm 2mm;
  }
  .profile { font-size: 9pt; color: rgba(255,255,255,0.92); line-height: 1.5; }

  /* ── Main column ─────────────────────────────────────────────────────── */
  main {
    ${band ? '' : 'grid-column: 2;'}
    padding: ${band ? '9mm 14mm 4mm' : '12mm 12mm 4mm'};
    display: flex; flex-direction: column;
  }
  .name { font-size: 24pt; font-weight: 700; letter-spacing: -0.01em; text-transform: uppercase; }
  .name .accent { color: ${theme.accent}; }
  .trade {
    font-size: 10pt; font-weight: 600; letter-spacing: 0.22em;
    text-transform: uppercase; color: #5b6472; margin-top: 1.5mm;
  }
  .namebar { width: 22mm; height: 1mm; background: ${theme.accent}; margin: 3mm 0 5mm; }

  .mh {
    font-size: 10.5pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: ${theme.ink}; margin-bottom: 3mm;
    padding-bottom: 1.2mm; border-bottom: 1pt solid #e3e7ee;
  }
  main section { margin-bottom: 6.5mm; }

  ul.exp { list-style: none; padding-left: 4mm; border-left: 0.8pt solid #e3e7ee; }
  ul.exp li { position: relative; margin-bottom: 4.5mm; }
  ul.exp li::before {
    content: ""; position: absolute; left: -5.4mm; top: 1.6mm;
    width: 2.4mm; height: 2.4mm; border-radius: 50%; background: ${theme.accent};
  }
  ul.exp .row { display: flex; align-items: baseline; gap: 3mm; }
  ul.exp .role { font-size: 10.5pt; font-weight: 700; flex: 1; }
  ul.exp .dur { font-size: 8.5pt; color: #6b7480; white-space: nowrap; }
  ul.exp .co { font-size: 9.5pt; color: #45505f; }
  ul.exp .tag { font-size: 8.5pt; color: ${theme.accent}; font-weight: 600; }

  .aigrid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.5mm 6mm; }
  .ai { font-size: 9pt; display: flex; gap: 2mm; }
  .ai .k { color: #6b7480; min-width: 26mm; }
  .ai .v { font-weight: 600; }
  .vid { font-size: 9.5pt; }

  /*
    The five detail blocks are written for the coloured sidebar (white text,
    translucent chips). The band layout moves them into the white column,
    where those colours are invisible — so it restates each one. Scoped
    to the main column, so the sidebar layouts are untouched.
  */
  main ul.plain li { color: #45505f; }
  main ul.chips li { background: #eef1f6; color: ${theme.ink}; }
  main .profile { color: #45505f; }
  .bandname { color: #fff; }
  .bandtrade { color: rgba(255,255,255,0.78); }

  footer {
    ${band ? '' : 'grid-column: 2;'}
    margin-top: auto; margin-inline: ${band ? '14mm' : '12mm'};
    padding: 3mm 0 8mm; border-top: 0.6pt solid #e3e7ee;
    font-size: 7.5pt; color: #9aa3ae;
  }
</style>
</head>
<body>
  ${watermarkLayer()}
  <aside class="side">
    ${photo}
    ${band ? `<div><h1 class="name bandname">${esc(first)} ${rest ? `<span class="accent">${esc(rest)}</span>` : ''}</h1>${view.jobCategory ? `<p class="trade bandtrade">${esc(view.jobCategory)}</p>` : ''}</div>` : ''}
    ${band ? '' : contactBlock(view, sideHeading)}
    ${band ? '' : profileBlock(view, sideHeading)}
    ${band ? '' : skillsBlock(view, sideHeading)}
    ${band ? '' : languagesBlock(view, sideHeading)}
    ${band ? '' : documentsBlock(view, sideHeading)}
  </aside>

  <main>
    ${
      band
        ? ''
        : `<header>
      <h1 class="name">${esc(first)} ${rest ? `<span class="accent">${esc(rest)}</span>` : ''}</h1>
      ${view.jobCategory ? `<p class="trade">${esc(view.jobCategory)}</p>` : ''}
      <div class="namebar"></div>
    </header>`
    }
    ${band ? contactBlock(view, mainHeading) : ''}
    ${band ? profileBlock(view, mainHeading) : ''}
    ${experienceSection(view)}
    ${band ? skillsBlock(view, mainHeading) : ''}
    ${band ? languagesBlock(view, mainHeading) : ''}
    ${band ? documentsBlock(view, mainHeading) : ''}
    ${additionalInfo(view)}
    ${video}
  </main>

  <footer>Generated by Skill India Connect &middot; ${esc(view.generatedAt.slice(0, 10))}</footer>
</body>
</html>`;
}
