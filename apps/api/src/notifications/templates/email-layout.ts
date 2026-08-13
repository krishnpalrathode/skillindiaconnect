/**
 * THE Skill India Connect email shell — one branded frame every outbound email
 * renders inside.
 *
 * Before this, every email resolved to `<p>escaped text</p>`: no header, no
 * brand, no call to action, no plain-text alternative worth the name. That is
 * what a candidate received alongside the resume they were about to forward to
 * a Gulf employer, so the weakest-looking artefact in the whole product sat at
 * the exact moment the product asks to be trusted.
 *
 * ── WHY THIS LOOKS LIKE HTML FROM 2004 ──────────────────────────────────────
 * Email clients are not browsers. Outlook 2016–2021 renders through Microsoft
 * Word, which supports no flexbox, no grid, no `max-width` on divs, and drops
 * most of a `<style>` block. So:
 *
 * - LAYOUT IS TABLES with `role="presentation"`, nested rather than positioned.
 * - EVERY STYLE IS INLINE. The `<style>` block carries progressive enhancement
 *   only (responsive + dark mode); nothing in it is load-bearing, because Gmail
 *   on iOS and several corporate filters strip it entirely.
 * - THE BUTTON IS BULLETPROOF: a VML `roundrect` behind an MSO conditional for
 *   Outlook, a padded anchor everywhere else. A CSS-styled `<a>` alone renders
 *   in Outlook as bare blue underlined text, which is the difference between a
 *   call to action and a link someone misses.
 * - WIDTH IS 600px, the width that survives every desktop client's reading pane.
 *
 * ── WHAT MAKES IT LOOK LIKE A REAL BRAND ────────────────────────────────────
 * - A PREHEADER: the grey line the inbox shows after the subject. Left unset it
 *   fills with whatever text comes first — usually "View in browser" or, here,
 *   the logo's alt text. It is set per email and then hidden.
 * - The logo is a remote image AND the wordmark is live text beneath it, so the
 *   mail still reads as Skill India Connect with images blocked — which is the
 *   default in Outlook and for most corporate recipients.
 * - Dark mode is handled rather than ignored: without `color-scheme` the shell
 *   gets auto-inverted by iOS Mail into muddy near-black on navy.
 *
 * Nothing here is fetched at render time except the logo, which is a normal
 * hosted image the client requests (or doesn't).
 */

/** Brand tokens. The same navy/orange the app and the resume PDFs use. */
export const BRAND = {
  navy: '#0F3D91',
  navyDark: '#0B2E6F',
  orange: '#F57C20',
  ink: '#1F2933',
  body: '#3E4C59',
  muted: '#7B8794',
  hairline: '#E4E7EB',
  tintBg: '#F4F7FC',
  white: '#FFFFFF',
  name: 'Skill India Connect',
  tagline: 'Elevating Skills, Connecting Futures',
} as const;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A url safe to place in `href`.
 *
 * Only http(s) survives. Everything else collapses to '#', which keeps a
 * `javascript:` or `data:` url out of a link — these bodies interpolate values
 * that ultimately trace back to user-controlled records, and an email client is
 * a rendering context like any other.
 */
export function safeUrl(value: string): string {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? escapeHtml(trimmed) : '#';
}

/** A labelled row in the detail block (job title, company, plan…). */
export type EmailFact = [label: string, value: string];

export interface EmailCallToAction {
  label: string;
  url: string;
}

export interface EmailBody {
  /** Inbox preview line. Never reuse the subject — it doubles the same words. */
  preheader: string;
  /** The one-line headline inside the card. */
  heading: string;
  /** Lead paragraph, set slightly larger. */
  intro?: string;
  /** Body paragraphs, in order. */
  paragraphs?: string[];
  /** Optional labelled details, rendered as a tinted panel. */
  facts?: EmailFact[];
  /** The single primary action. Deliberately at most one per email. */
  cta?: EmailCallToAction;
  /** Fine print under the action — security notes, expiry warnings. */
  note?: string;
}

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function paragraph(text: string, size = '15px', color: string = BRAND.body): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:${size};line-height:1.6;color:${color};">${escapeHtml(
    text,
  )}</p>`;
}

function factsPanel(facts: EmailFact[]): string {
  const rows = facts
    .map(
      ([label, value]) => `
              <tr>
                <td style="padding:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.4;color:${BRAND.muted};text-transform:uppercase;letter-spacing:0.06em;white-space:nowrap;" valign="top">${escapeHtml(
                  label,
                )}</td>
                <td style="padding:0 0 8px 16px;font-family:${FONT};font-size:15px;line-height:1.4;color:${BRAND.ink};font-weight:600;" valign="top">${escapeHtml(
                  value,
                )}</td>
              </tr>`,
    )
    .join('');

  return `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${BRAND.tintBg};border-radius:10px;margin:0 0 24px;">
          <tr>
            <td style="padding:18px 20px 10px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}
              </table>
            </td>
          </tr>
        </table>`;
}

/**
 * The action button.
 *
 * The MSO block draws a VML rectangle Outlook can actually fill; every other
 * client ignores it inside the conditional comment and renders the anchor. Both
 * carry the same label and href, so there is one action either way.
 */
function ctaButton(cta: EmailCallToAction): string {
  const href = safeUrl(cta.url);
  const label = escapeHtml(cta.label);
  return `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
          <tr>
            <td align="center" bgcolor="${BRAND.navy}" style="border-radius:8px;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="17%" stroke="f" fillcolor="${BRAND.navy}">
                <w:anchorlock/>
                <center style="color:#FFFFFF;font-family:${FONT};font-size:16px;font-weight:bold;">${label}</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-- -->
              <a href="${href}" style="display:inline-block;padding:14px 32px;font-family:${FONT};font-size:16px;font-weight:600;color:${BRAND.white};text-decoration:none;border-radius:8px;background-color:${BRAND.navy};mso-hide:all;">${label}</a>
              <!--<![endif]-->
            </td>
          </tr>
        </table>`;
}

/**
 * Wrap content in the branded shell.
 *
 * `logoUrl` is optional on purpose: with no WEB_APP_URL configured the header
 * still renders the wordmark as text rather than a broken image icon.
 */
export function renderEmailLayout(
  body: EmailBody,
  options: { webAppUrl?: string; year?: number } = {},
): string {
  const base = options.webAppUrl?.replace(/\/+$/, '') ?? '';
  const year = options.year ?? new Date().getFullYear();
  const logo = base ? `${base}/brand/SIC_mark.png` : '';

  const intro = body.intro ? paragraph(body.intro, '17px', BRAND.ink) : '';
  const paras = (body.paragraphs ?? []).map((p) => paragraph(p)).join('');
  const facts = body.facts?.length ? factsPanel(body.facts) : '';
  const cta = body.cta ? ctaButton(body.cta) : '';
  const note = body.note
    ? `<p style="margin:0;padding:16px 0 0;border-top:1px solid ${BRAND.hairline};font-family:${FONT};font-size:13px;line-height:1.6;color:${BRAND.muted};">${escapeHtml(
        body.note,
      )}</p>`
    : '';

  /*
    The logo is a normal hosted image. It sits ABOVE a text wordmark rather than
    replacing it, because images are blocked by default in Outlook and most
    corporate clients — with them off, the header must still say who this is.
  */
  const logoImg = logo
    ? `<img src="${safeUrl(logo)}" width="40" height="40" alt="" style="display:block;border:0;outline:none;text-decoration:none;width:40px;height:40px;margin:0 auto 10px;" />`
    : '';

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${escapeHtml(body.heading)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
  /* Progressive enhancement ONLY — every client-critical style is inline above.
     Gmail on iOS and several corporate filters strip this block entirely. */
  @media only screen and (max-width:620px) {
    .sic-wrap { width:100% !important; }
    .sic-pad { padding-left:22px !important; padding-right:22px !important; }
    .sic-h1 { font-size:22px !important; }
    .sic-btn a { display:block !important; text-align:center !important; }
  }
  @media (prefers-color-scheme: dark) {
    .sic-page { background-color:#0E1620 !important; }
    .sic-card { background-color:#16202C !important; }
    .sic-text { color:#C7D0DA !important; }
    .sic-ink { color:#F2F5F8 !important; }
    .sic-panel { background-color:#1D2836 !important; }
    .sic-muted { color:#94A3B4 !important; }
  }
  a { color:${BRAND.navy}; }
</style>
</head>
<body class="sic-page" style="margin:0;padding:0;width:100%;background-color:${BRAND.tintBg};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <!-- Preheader: the inbox preview line. Hidden in the body, then padded so the
       client cannot pull following markup into the preview. -->
  <div style="display:none;font-size:1px;color:${BRAND.tintBg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(
    body.preheader,
  )}&#8203;${'&#847;&zwnj;&nbsp;&#847;'.repeat(60)}</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="sic-page" style="background-color:${BRAND.tintBg};">
    <tr>
      <td align="center" style="padding:32px 12px;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="sic-wrap" style="width:600px;max-width:600px;">

          <!-- Brand header -->
          <tr>
            <td align="center" style="padding:0 0 22px;">
              ${logoImg}
              <div style="font-family:${FONT};font-size:19px;font-weight:700;letter-spacing:-0.01em;color:${BRAND.navy};">Skill India <span style="color:${BRAND.orange};">Connect</span></div>
              <div style="font-family:${FONT};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.muted};padding-top:5px;">${escapeHtml(
                BRAND.tagline,
              )}</div>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td class="sic-card" style="background-color:${BRAND.white};border-radius:14px;border:1px solid ${BRAND.hairline};overflow:hidden;">

              <!-- Accent rule: the brand's two colours, and the only decoration
                   that survives with images off. -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td height="4" style="height:4px;line-height:4px;font-size:0;background-color:${BRAND.navy};">&nbsp;</td>
                  <td height="4" width="90" style="height:4px;line-height:4px;font-size:0;width:90px;background-color:${BRAND.orange};">&nbsp;</td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td class="sic-pad" style="padding:34px 40px 30px;">
                    <h1 class="sic-h1 sic-ink" style="margin:0 0 18px;font-family:${FONT};font-size:25px;line-height:1.28;font-weight:700;color:${BRAND.ink};letter-spacing:-0.015em;">${escapeHtml(
                      body.heading,
                    )}</h1>
                    ${intro}
                    ${paras}
                    ${facts}
                    ${cta}
                    ${note}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="sic-pad" style="padding:24px 24px 0;text-align:center;">
              <p class="sic-muted" style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.6;color:${BRAND.muted};">${escapeHtml(
                BRAND.name,
              )} &middot; connecting skilled Indian workers with verified employers in India and the Gulf.</p>
              <p class="sic-muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${BRAND.muted};">This is an automated message about your account. &copy; ${year} ${escapeHtml(
                BRAND.name,
              )}.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * The plain-text alternative — a real one, not a stripped-tags afterthought.
 *
 * Every multipart email needs it: text-only clients, screen readers in text
 * mode, and spam filters that score HTML-only mail worse. Built from the SAME
 * `EmailBody` so the two versions cannot drift, and the CTA appears as a bare
 * url because a text part has nowhere to hide a link.
 */
export function renderEmailText(body: EmailBody): string {
  const lines: string[] = [`${BRAND.name}`, '='.repeat(BRAND.name.length), '', body.heading, ''];

  if (body.intro) lines.push(body.intro, '');
  for (const p of body.paragraphs ?? []) lines.push(p, '');
  for (const [label, value] of body.facts ?? []) lines.push(`${label}: ${value}`);
  if (body.facts?.length) lines.push('');
  if (body.cta) lines.push(`${body.cta.label}: ${body.cta.url}`, '');
  if (body.note) lines.push(body.note, '');

  lines.push('—', `${BRAND.name} · ${BRAND.tagline}`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
