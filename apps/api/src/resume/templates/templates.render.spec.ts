/**
 * CR-001 B2 — what the three new templates must do BEYOND the privacy gate.
 *
 * The byte-level omission gate lives in resume-render.spec.ts and already runs
 * for all four templates. This file covers the rest of the B2 bar: that the
 * choice is real, that a sparse profile still looks intentional, and that long
 * values wrap instead of vanishing.
 *
 * HTML-level where HTML is enough. Rendering four templates through Chromium
 * for every assertion would add minutes to the suite and prove nothing extra —
 * the PDF-level proof is the privacy gate, which is the assertion that actually
 * needs the bytes.
 */
import { ResumeTemplate } from '@prisma/client';
import { ResumeSource } from '../../candidate/candidate-read.service';
import {
  RESUME_SETTINGS_DEFAULTS,
  ResumeRenderSettings,
  toResumeView,
} from '../resume-view.mapper';
import { TEMPLATE_REGISTRY } from './registry';

const LONG_COMPANY = 'Al Habtoor Leighton Specialist Electromechanical Contracting Company LLC';
const settings: ResumeRenderSettings = { ...RESUME_SETTINGS_DEFAULTS, showPhone: true };

const full: ResumeSource = {
  id: 'cand-1',
  fullName: 'Suresh Kumar',
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
  documents: [
    { type: 'PASSPORT', expiryDate: new Date('2031-01-01'), documentNumber: 'Z9876543' },
  ],
};

/** One experience, no photo, no skills, no documents — the common case here. */
const sparse: ResumeSource = {
  ...full,
  skills: [],
  languages: [],
  documents: [],
  religion: null,
  maritalStatus: null,
  nationality: null,
  dob: null,
};

const PHOTO = `data:image/jpeg;base64,${'A'.repeat(64)}`;
const ALL = Object.keys(TEMPLATE_REGISTRY) as ResumeTemplate[];

function html(template: ResumeTemplate, source: ResumeSource, photo: string | null = null): string {
  return TEMPLATE_REGISTRY[template](toResumeView(source, settings, photo));
}

describe('the choice is REAL — templates are not the same document', () => {
  it('every template produces different markup from the same view', () => {
    // If two templates rendered identically the picker would be a lie: the
    // candidate would choose, regenerate, and receive the same PDF.
    const outputs = new Map(ALL.map((t) => [t, html(t, full)]));
    const unique = new Set(outputs.values());
    expect(unique.size).toBe(ALL.length);
  });

  it('COMPACT is the only two-column layout', () => {
    expect(html(ResumeTemplate.COMPACT, full)).toContain('grid-template-columns');
    for (const t of [ResumeTemplate.CLASSIC, ResumeTemplate.MODERN, ResumeTemplate.MINIMAL]) {
      expect(html(t, full)).not.toContain('grid-template-columns: 56mm');
    }
  });

  it('MINIMAL deliberately omits the photo; the others render it', () => {
    // A design decision about this template (parsers stumble on images and its
    // selling point is machine-readability) — NOT a privacy rule.
    expect(html(ResumeTemplate.MINIMAL, full, PHOTO)).not.toContain('<img');
    for (const t of [ResumeTemplate.CLASSIC, ResumeTemplate.MODERN, ResumeTemplate.COMPACT]) {
      expect(html(t, full, PHOTO)).toContain('<img');
    }
  });
});

describe.each(ALL)('%s — robustness', (template) => {
  it('renders a SPARSE profile as a complete document', () => {
    const out = html(template, sparse);
    expect(out).toContain('Suresh Kumar');
    expect(out).toContain('suresh@example.com');
    expect(out).toMatch(/<\/html>\s*$/);
    // Empty sections must not render as bare headings with nothing under them.
    expect(out).not.toContain('<h2>Skills</h2>');
    expect(out).not.toContain('<h2>Documents</h2>');
    expect(out).not.toContain('Video Portfolio');
  });

  it('keeps a very long company name intact rather than truncating it', () => {
    const out = html(template, {
      ...full,
      experiences: [{ ...full.experiences[0]!, companyName: LONG_COMPANY }],
    });
    expect(out).toContain(LONG_COMPANY);
  });

  it('renders 25 skills without dropping any', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `sk-${i}`,
      name: `Skill Number ${i}`,
    }));
    const out = html(template, { ...full, skills: many });
    for (const s of many) expect(out).toContain(s.name);
  });

  it('declares a wrapping rule so long tokens cannot overflow the page', () => {
    // The shared page frame carries overflow-wrap; assert each template
    // actually includes it rather than trusting that it does.
    expect(html(template, full)).toContain('overflow-wrap: anywhere');
  });

  it('is self-contained — no external fetch can hang the render', () => {
    const out = html(template, full, PHOTO);
    expect(out).not.toMatch(/<link\b/);
    expect(out).not.toMatch(/@import/);
    expect(out).not.toMatch(/src="https?:/);
    expect(out).not.toMatch(/url\(\s*['"]?https?:/);
  });
});
