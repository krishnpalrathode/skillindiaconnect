import { NotificationType } from '@prisma/client';
import { renderNotificationEmail } from './index';
import { renderEmailLayout, renderEmailText, safeUrl, escapeHtml } from './email-layout';

/**
 * What a branded transactional email must hold true, for EVERY notification
 * type — not just the handful anyone looks at.
 *
 * These are deliberately property-style assertions rather than snapshots. A
 * snapshot of 21 emails would go stale on every copy tweak and get blanket
 * `-u`'d, which is how a broken email ships green. The properties below are the
 * things that actually make the difference between mail that arrives and mail
 * that lands in spam, renders blank in Outlook, or leaks markup.
 */

const WEB = 'https://skillindiaconnect.com';
const ALL_TYPES = Object.values(NotificationType);

function render(type: NotificationType, over: Partial<Parameters<typeof renderNotificationEmail>[0]> = {}) {
  return renderNotificationEmail({
    type,
    title: 'Something happened',
    body: 'Here is the detail about the thing that happened.',
    data: {},
    webAppUrl: WEB,
    ...over,
  });
}

describe.each(ALL_TYPES)('%s email', (type) => {
  const mail = render(type);

  it('has a non-empty subject that is not the raw enum name', () => {
    expect(mail.subject.trim()).not.toBe('');
    // 'APPLICATION_SELECTED' reaching an inbox is the classic template-never-
    // finished tell.
    expect(mail.subject).not.toMatch(/^[A-Z_]+$/);
  });

  it('ships BOTH an html and a plain-text part', () => {
    // HTML-only transactional mail scores worse with spam filters and renders
    // as nothing in text-mode clients.
    expect(mail.html).toContain('<!doctype html>');
    expect(mail.text.trim().length).toBeGreaterThan(40);
  });

  it('carries a preheader so the inbox preview is not filler', () => {
    expect(mail.html).toMatch(/display:none;font-size:1px/);
  });

  it('is laid out with tables, not flexbox or grid', () => {
    /*
      Outlook 2016–2021 renders through Word: no flex, no grid, no max-width on
      divs. A layout that uses them collapses into a single unstyled column for
      a large share of employer recipients.
    */
    expect(mail.html).toContain('role="presentation"');
    expect(mail.html).not.toMatch(/display:\s*flex/);
    expect(mail.html).not.toMatch(/display:\s*grid/);
  });

  it('fetches no stylesheet, script, or font', () => {
    // Anything external beyond images is stripped or blocked by mail clients.
    expect(mail.html).not.toMatch(/<link\b/i);
    expect(mail.html).not.toMatch(/<script\b/i);
    expect(mail.html).not.toMatch(/@import/i);
  });

  it('names the brand even with images blocked', () => {
    // Images are off by default in Outlook and most corporate clients, so the
    // wordmark has to be live text.
    const withoutImages = mail.html.replace(/<img[\s\S]*?>/g, '');
    expect(withoutImages).toContain('Skill India');
  });
});

describe('escaping — bodies interpolate values that trace back to user input', () => {
  it('escapes markup in the caller title, body and facts', () => {
    const mail = render(NotificationType.JOB_APPROVED, {
      title: '<script>alert(1)</script>',
      body: 'Job "<b>Welder</b>" approved',
      data: { jobTitle: '<img src=x onerror=alert(1)>', humanId: 'JOB-1' },
    });

    expect(mail.html).not.toContain('<script>alert(1)</script>');
    expect(mail.html).not.toContain('<img src=x onerror');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('escapeHtml covers the five characters that matter', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('link safety', () => {
  it.each(['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'not a url'])(
    'refuses to emit %s as an href',
    (bad) => {
      expect(safeUrl(bad)).toBe('#');
    },
  );

  it('keeps ordinary http(s) urls', () => {
    expect(safeUrl('https://example.com/a?b=c')).toBe('https://example.com/a?b=c');
  });

  it('does not put a caller-supplied javascript: url in the reset button', () => {
    const mail = render(NotificationType.PASSWORD_RESET, {
      data: { resetUrl: 'javascript:steal()' },
    });
    expect(mail.html).not.toContain('javascript:steal');
  });
});

describe('the resume email — the one a candidate forwards to an employer', () => {
  const withPdf = render(NotificationType.RESUME_SENT, {
    title: 'Your resume is ready to share',
    body: 'Your resume PDF is attached to this email.',
    hasAttachment: true,
  });

  it('says the PDF is attached', () => {
    // A recipient who does not notice the attachment concludes the mail is
    // empty — the single most likely failure of this specific email.
    expect(withPdf.html).toMatch(/attached to this email/i);
    expect(withPdf.text).toMatch(/attached to this email/i);
  });

  it('omits the attachment line when nothing is attached', () => {
    const noPdf = render(NotificationType.RESUME_SENT, { hasAttachment: false });
    expect(noPdf.html).not.toMatch(/attached to this email as a PDF/i);
  });

  it('carries the anti-fraud warning this audience needs', () => {
    // Migrant workers are targeted with advance-fee scams off the back of exactly
    // this kind of message. The warning belongs where the document travels.
    expect(withPdf.html).toMatch(/never asks you to pay/i);
    expect(withPdf.text).toMatch(/never asks you to pay/i);
  });
});

describe('degradation when WEB_APP_URL is unset', () => {
  const mail = render(NotificationType.APPLICATION_SELECTED, { webAppUrl: '' });

  it('renders without a dead button rather than linking to nowhere', () => {
    expect(mail.html).not.toContain('href="#"');
    expect(mail.html).not.toMatch(/<v:roundrect/);
    expect(mail.subject.trim()).not.toBe('');
  });
});

describe('the text part mirrors the html', () => {
  it('includes the call-to-action url as bare text', () => {
    const body = {
      preheader: 'p',
      heading: 'Heading',
      intro: 'Intro line',
      cta: { label: 'Do the thing', url: `${WEB}/en/jobs` },
    };
    const text = renderEmailText(body);
    expect(text).toContain(`${WEB}/en/jobs`);
    expect(text).toContain('Heading');
  });

  it('renders an html shell for the same body', () => {
    const html = renderEmailLayout({ preheader: 'p', heading: 'H', intro: 'i' }, { webAppUrl: WEB });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('H');
  });
});
