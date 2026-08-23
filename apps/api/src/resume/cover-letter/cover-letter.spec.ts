/**
 * The cover letter — content and format.
 *
 * These test the things that make a letter read as WRITTEN rather than
 * generated, because that is the only reason to ship one at all:
 *
 *  - sincerely/faithfully agreeing with the salutation (the single most common
 *    error in business correspondence, and an instant tell);
 *  - an unambiguous date;
 *  - never claiming evidence the profile does not have;
 *  - honouring the same privacy omissions as the resume beside it.
 */
import { ResumeTemplate } from '@prisma/client';
import { ResumeSource } from '../../candidate/candidate-read.service';
import {
  RESUME_SETTINGS_DEFAULTS,
  ResumeRenderSettings,
  toResumeView,
} from '../resume-view.mapper';
import { buildCoverLetter, formatLetterDate } from './cover-letter.content';
import { renderCoverLetter } from './cover-letter.template';

const settings: ResumeRenderSettings = {
  ...RESUME_SETTINGS_DEFAULTS,
  showPhone: true,
  template: ResumeTemplate.CLASSIC,
};

const source: ResumeSource = {
  id: 'cand-1',
  fullName: 'Suresh Kumar',
  summary: null,
  fatherName: 'Ram Prasad Kumar',
  dob: new Date('1994-03-12'),
  phone: '+919876543210',
  maritalStatus: 'MARRIED',
  religion: 'Hindu',
  languages: ['Hindi', 'English'],
  currentLocation: 'Lucknow, India',
  nationality: 'Indian',
  photoKey: null,
  videoR2Key: null,
  jobCategory: { nameEn: 'Electrician' },
  user: { email: 'suresh@example.com' },
  experiences: [
    {
      id: 'exp-1',
      type: 'FOREIGN',
      country: 'Oman',
      companyName: 'Gulf Wiring LLC',
      role: 'Senior Electrician',
      years: 4,
      months: 2,
      startDate: null,
      endDate: null,
    },
  ],
  skills: [
    { id: 'sk-1', name: 'Panel Installation' },
    { id: 'sk-2', name: 'Circuit Testing' },
  ],
  documents: [{ type: 'PASSPORT', expiryDate: new Date('2031-01-01'), documentNumber: 'Z9876543' }],
};

const view = (over: Partial<ResumeSource> = {}) =>
  toResumeView({ ...source, ...over }, settings, null);

describe('buildCoverLetter — business-letter correctness', () => {
  it('closes "Yours faithfully" when nobody is named', () => {
    // British/Indian convention, which the Gulf corridor follows.
    const letter = buildCoverLetter(view(), { companyName: 'Al Habtoor' });
    expect(letter.salutation).toBe('Dear Sir or Madam,');
    expect(letter.closing).toBe('Yours faithfully,');
  });

  it('closes "Yours sincerely" when the addressee IS named', () => {
    const letter = buildCoverLetter(view(), { recipientName: 'Mr Khalid Al-Amin' });
    expect(letter.salutation).toBe('Dear Mr Khalid Al-Amin,');
    expect(letter.closing).toBe('Yours sincerely,');
  });

  it('writes the date unambiguously, with the month spelled out', () => {
    // 08/09/2026 is two different days depending on the reader's country, and
    // this letter crosses exactly that border.
    const formatted = formatLetterDate('2026-08-18T00:00:00.000Z');
    expect(formatted).toBe('18 August 2026');
    expect(formatted).not.toMatch(/\d+\/\d+/);
  });

  it('carries a subject line so a detached letter still says what it is about', () => {
    const letter = buildCoverLetter(view(), { roleTitle: 'Site Electrician' });
    expect(letter.subject).toContain('Site Electrician');
    expect(letter.subject.startsWith('RE:')).toBe(true);
  });

  it('names the company in the opening and the close when given one', () => {
    const letter = buildCoverLetter(view(), { companyName: 'Al Habtoor' });
    expect(letter.paragraphs[0]).toContain('Al Habtoor');
    expect(letter.paragraphs[letter.paragraphs.length - 1]).toContain('Al Habtoor');
  });

  it('states the real total experience, not a rounded boast', () => {
    const letter = buildCoverLetter(view());
    expect(letter.paragraphs.join(' ')).toContain('4 years 2 months');
  });

  it("leads with the candidate's own summary when they wrote one", () => {
    const letter = buildCoverLetter(view({ summary: 'I take pride in safe, tidy work.' }));
    expect(letter.paragraphs[0]).toBe('I take pride in safe, tidy work.');
  });
});

describe('buildCoverLetter — never claims what the profile cannot show', () => {
  it('omits the passport sentence when there is no passport', () => {
    const letter = buildCoverLetter(view({ documents: [] }));
    const text = letter.paragraphs.join(' ');
    expect(text).not.toMatch(/passport/i);
  });

  it('omits the skills sentence when there are no skills', () => {
    const letter = buildCoverLetter(view({ skills: [] }));
    expect(letter.paragraphs.join(' ')).not.toMatch(/My main skills/);
  });

  it('omits the overseas sentence for a purely domestic history', () => {
    const letter = buildCoverLetter(
      view({ experiences: [{ ...source.experiences[0]!, type: 'INDIA', country: 'India' }] }),
    );
    expect(letter.paragraphs.join(' ')).not.toMatch(/worked overseas/);
  });

  it('still produces a complete, sendable letter from a sparse profile', () => {
    const letter = buildCoverLetter(
      view({ experiences: [], skills: [], documents: [], languages: [] }),
    );
    // Salutation, subject, at least an opening and a close, sign-off.
    expect(letter.salutation).toBeTruthy();
    expect(letter.subject).toBeTruthy();
    expect(letter.paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(letter.closing).toBeTruthy();
    expect(letter.enclosure).toContain('Curriculum Vitae');
  });
});

describe('renderCoverLetter — the printed page', () => {
  it('honours the SAME privacy omissions as the resume', () => {
    // showPhone false must hide the number here too; a letter that printed a
    // phone the CV withheld would defeat the setting entirely.
    const hidden = toResumeView(source, { ...settings, showPhone: false }, null);
    const html = renderCoverLetter(buildCoverLetter(hidden));
    expect(html).not.toContain('+919876543210');
    expect(html).toContain('suresh@example.com');
  });

  it('escapes user text rather than emitting live markup', () => {
    const html = renderCoverLetter(
      buildCoverLetter(view(), { companyName: '<script>alert(1)</script>' }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('carries the Skill India Connect watermark, tiled and behind the text', () => {
    /*
      HTML-level, not PDF-level, and deliberately so: the cover letter has no
      Chromium spec of its own (jest.chromium.config.ts matches only
      browser-pool / resume-render / invoice-render), and the PRINT behaviour of
      this exact helper is already proven on the PDF bytes for all nine resume
      templates in resume-render.spec.ts. What is worth pinning here is that the
      letter opts in at all, and opts in the same way.
    */
    const html = renderCoverLetter(buildCoverLetter(view()));

    // Tiled, not a single stamp — one mark on a page is a typo, not a watermark.
    const marks = html.split('>Skill India Connect<').length - 1;
    expect(marks).toBeGreaterThanOrEqual(10);

    // Behind the text: a watermark painted OVER a letter makes it unreadable.
    expect(html).toMatch(/\.wm \{[^}]*z-index: -1/);
    // Repeats on page two — the property the footer deliberately avoids.
    expect(html).toMatch(/\.wm \{[^}]*position: fixed/);
  });

  it('is self-contained — Chromium must fetch nothing', () => {
    const html = renderCoverLetter(buildCoverLetter(view()));
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/@import/);
    expect(html).not.toMatch(/src="https?:/);
  });

  it('renders the letter parts in the order a business letter requires', () => {
    const html = renderCoverLetter(buildCoverLetter(view(), { recipientName: 'Mr Khalid' }));
    const order = ['Suresh Kumar', 'August', 'Mr Khalid', 'Dear Mr Khalid', 'RE:'].map((s) =>
      html.indexOf(s),
    );
    expect(order.every((i) => i > -1)).toBe(true);
    // Sender → date → recipient → salutation → subject, strictly increasing.
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // …and the sign-off comes after the body.
    expect(html.indexOf('Yours sincerely')).toBeGreaterThan(html.indexOf('RE:'));
  });
});
