import { esc, pageFrame, watermarkFrame, watermarkLayer } from '../templates/shared';
import { CoverLetterContent } from './cover-letter.content';

/**
 * The cover letter, as A4 print.
 *
 * ── Typography ─────────────────────────────────────────────────────────────
 * A serif body at 11pt on generous leading, 25mm margins. This is deliberately
 * NOT styled like the resume templates: a resume is a scannable document and
 * earns colour, rules and chips; a letter is prose and every one of those
 * devices makes it look like a flyer. The only ink beyond black text is a thin
 * rule under the sender block.
 *
 * ── One page, enforced by construction ────────────────────────────────────
 * `buildCoverLetter` caps the content at four short paragraphs, so there is no
 * pagination logic here — if a letter ever did overflow, that is a content bug
 * to fix upstream, not something to hide with a smaller font.
 *
 * Same hard rules as every template in this codebase: everything inline,
 * Chromium fetches nothing, and every interpolated value passes through esc()
 * because all of it is user input.
 */
export function renderCoverLetter(letter: CoverLetterContent): string {
  const contact = letter.senderContact.map(esc).join(' &nbsp;&middot;&nbsp; ');
  const recipient = letter.recipientLines.map((l) => `<p>${esc(l)}</p>`).join('\n');
  const body = letter.paragraphs.map((p) => `<p class="para">${esc(p)}</p>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  ${pageFrame('25mm 22mm')}
  ${watermarkFrame()}
  body {
    /* Serif for prose. Georgia is present on every platform Chromium runs on
       here and reads better at length than the UI sans the resumes use. */
    font-family: Georgia, "Times New Roman", Times, serif;
    font-size: 11pt; color: #1a1a1a; line-height: 1.65;
  }

  /* ── Sender block ── */
  header { border-bottom: 0.75pt solid #cfcfcf; padding-bottom: 4mm; margin-bottom: 8mm; }
  h1 { font-size: 17pt; font-weight: 700; letter-spacing: 0.01em; }
  .headline {
    font-size: 10pt; text-transform: uppercase; letter-spacing: 0.1em;
    color: #555; margin-top: 1mm;
  }
  .contact { font-size: 9.5pt; color: #444; margin-top: 2.5mm; }

  /* ── Letter furniture ── */
  .date { margin-bottom: 7mm; }
  .recipient { margin-bottom: 7mm; }
  .recipient p { margin: 0; }
  .salutation { margin-bottom: 4mm; }
  .subject { font-weight: 700; margin-bottom: 5mm; }

  /* Full block format: flush left, no first-line indent, space between
     paragraphs. Indents AND blank lines together is the classic error. */
  .para { margin: 0 0 4.5mm; text-align: left; }

  .closing { margin-top: 7mm; }
  .signature { margin-top: 12mm; font-weight: 700; }
  .enclosure { margin-top: 8mm; font-size: 9.5pt; color: #555; }
</style>
</head>
<body>
  ${watermarkLayer()}
  <header>
    <h1>${esc(letter.senderName)}</h1>
    ${letter.senderHeadline ? `<p class="headline">${esc(letter.senderHeadline)}</p>` : ''}
    ${contact ? `<p class="contact">${contact}</p>` : ''}
  </header>

  ${letter.date ? `<p class="date">${esc(letter.date)}</p>` : ''}

  ${recipient ? `<div class="recipient">${recipient}</div>` : ''}

  <p class="salutation">${esc(letter.salutation)}</p>
  <p class="subject">${esc(letter.subject)}</p>

  <main>
    ${body}
  </main>

  <p class="closing">${esc(letter.closing)}</p>
  <p class="signature">${esc(letter.senderName)}</p>
  <p class="enclosure">${esc(letter.enclosure)}</p>
</body>
</html>`;
}
