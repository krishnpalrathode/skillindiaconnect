/**
 * S7-B1 — THE PRIVACY TESTS: settings-driven omission proven on the PDF
 * BYTES. The resume is a file the candidate forwards to strangers; a field
 * that is "hidden but present" in the bytes is a real leak. So these tests
 * render through REAL Chromium and extract TEXT from the produced PDF —
 * asserting on rendered content, never on the view object alone.
 *
 * Also: the mapper's object-level omission, the language guard, the
 * render-service persistence flow (READY + snapshot), and the processor's
 * READY/FAILED + event + audit behavior (unit-level, mocked collaborators).
 */
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PDFParse } from 'pdf-parse';
import { ResumeGenerationStatus, ResumeTemplate } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';
import { CandidateReadService, ResumeSource } from '../candidate/candidate-read.service';
import { AuditService } from '../audit/audit.service';
import { BrowserPoolService } from '../pdf/browser-pool.service';
import { PdfRenderService } from '../pdf/pdf-render.service';
import {
  RESUME_SETTINGS_DEFAULTS,
  ResumeRenderSettings,
  toResumeView,
} from './resume-view.mapper';
import { renderResumeHtml } from './templates/resume.template';
import { TEMPLATE_REGISTRY, selectTemplate } from './templates/registry';
import { ResumeRenderService } from './resume-render.service';
import { ResumeRenderProcessor } from './resume-render.processor';
import { RESUME_EVENTS } from './resume.events';

jest.setTimeout(120_000);

const PASSPORT_NUMBER = 'Z9876543';
const RELIGION = 'Hindu';
const PHONE = '+919876543210';
const FATHER_NAME = 'Ram Prasad Kumar';

const source: ResumeSource = {
  id: 'cand-1',
  fullName: 'Suresh Kumar',
  fatherName: FATHER_NAME,
  dob: new Date('1994-03-12'),
  phone: PHONE,
  maritalStatus: 'MARRIED',
  religion: RELIGION,
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
    { type: 'PASSPORT', expiryDate: new Date('2031-01-01'), documentNumber: PASSPORT_NUMBER },
    { type: 'EXPERIENCE_CERT', expiryDate: null, documentNumber: null },
  ],
};

// Spread the defaults so a future setting added to ResumeRenderSettings does
// not have to be added by hand at every fixture site; only what the test is
// ABOUT is stated explicitly.
const allOn: ResumeRenderSettings = {
  ...RESUME_SETTINGS_DEFAULTS,
  showPhone: true,
  showReligion: true,
  showFatherName: true,
  showPassportNumber: true,
};
const allOff: ResumeRenderSettings = {
  ...RESUME_SETTINGS_DEFAULTS,
  showPhone: false,
  showReligion: false,
  showFatherName: false,
  showPassportNumber: false,
};

let pool: BrowserPoolService;

beforeAll(() => {
  pool = new BrowserPoolService({ get: () => undefined } as unknown as ConfigService);
});
afterAll(async () => {
  await pool.onModuleDestroy();
});

/** Extract the RENDERED text from PDF bytes — the assertion surface that matters. */
async function extractText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

/** Renders through the REGISTRY, so the template under test is the real one. */
async function renderToText(settings: ResumeRenderSettings): Promise<string> {
  const view = toResumeView(source, settings, null);
  const buffer = await pool.render(selectTemplate(settings.template)(view));
  return extractText(buffer);
}

/**
 * Every registered template, so B2 inherits the privacy gate automatically:
 * registering a renderer enrols it here with no test edit.
 */
const REGISTERED_TEMPLATES = Object.keys(TEMPLATE_REGISTRY) as ResumeTemplate[];

it('the byte-level gate below covers EVERY declared template', () => {
  // Without this, a registry that silently lost an entry would leave the loop
  // green while proving nothing about the missing template — the failure mode
  // of a parameterised suite is that it quietly shrinks.
  expect(REGISTERED_TEMPLATES.sort()).toEqual(Object.values(ResumeTemplate).sort());
});

// ── THE BLOCKING PRIVACY GATE, PER TEMPLATE ─────────────────────────────────
// Values only. Field LABELS are a template's own design decision (B2's
// templates are free to word them differently), but no template may ever emit
// a VALUE the mapper withheld. That rule is universal, so it is asserted for
// every template; the CLASSIC-specific label expectations live below.
describe.each(REGISTERED_TEMPLATES)(
  'settings-driven omission — IN THE PDF BYTES [%s]',
  (template) => {
    const on: ResumeRenderSettings = { ...allOn, template };
    const off: ResumeRenderSettings = { ...allOff, template };

    it('all toggles ON → passport number, religion, phone, father name are all PRESENT', async () => {
      const text = await renderToText(on);
      expect(text).toContain(PASSPORT_NUMBER);
      expect(text).toContain(RELIGION);
      expect(text).toContain(PHONE);
      expect(text).toContain(FATHER_NAME);
      // Sanity: the unconditional content rendered too.
      expect(text).toContain('Suresh Kumar');
      expect(text).toContain('Gulf Wiring LLC');
    });

    it('all toggles OFF → each value is ABSENT FROM THE BYTES (not merely hidden)', async () => {
      const text = await renderToText(off);
      expect(text).not.toContain(PASSPORT_NUMBER);
      expect(text).not.toContain(RELIGION);
      expect(text).not.toContain(PHONE);
      expect(text).not.toContain(FATHER_NAME);
      // The resume is still a resume.
      expect(text).toContain('Suresh Kumar');
      expect(text).toContain('suresh@example.com');
    });

    it('each toggle omits ONLY its own field (the passport-number case)', async () => {
      const text = await renderToText({ ...on, showPassportNumber: false });
      expect(text).not.toContain(PASSPORT_NUMBER);
      expect(text).toContain(RELIGION);
      expect(text).toContain(PHONE);
      expect(text).toContain(FATHER_NAME);
    });

    it('renders a SPARSE profile without breaking', async () => {
      // Many of our candidates' profiles are sparse — this is the common case,
      // not an edge case.
      const sparse: ResumeSource = {
        ...source,
        photoKey: null,
        skills: [],
        languages: [],
        experiences: [source.experiences[0]!],
        documents: [],
      };
      const view = toResumeView(sparse, on, null);
      const text = await extractText(await pool.render(selectTemplate(template)(view)));
      expect(text).toContain('Suresh Kumar');
      // No video → the section must be absent, never an empty placeholder.
      expect(text).not.toContain('Video Portfolio');
    });
  },
);

describe('CLASSIC label discipline (template-specific)', () => {
  it('omits the LABEL along with the value — no empty "Passport number:" row', async () => {
    const text = await renderToText({ ...allOff, template: ResumeTemplate.CLASSIC });
    expect(text).not.toContain('Passport number');
    expect(text).not.toContain('Religion');
    expect(text).not.toContain("Father's name");
  });

  it('still lists the passport in the documents summary (validity, no number)', async () => {
    const text = await renderToText({
      ...allOn,
      showPassportNumber: false,
      template: ResumeTemplate.CLASSIC,
    });
    expect(text).toContain('Passport');
    expect(text).not.toContain(PASSPORT_NUMBER);
  });
});

describe('toResumeView (the chokepoint, object level)', () => {
  it('omitted fields are ABSENT from the object — they can never reach the template', () => {
    const view = toResumeView(source, allOff, null);
    expect('phone' in view && view.phone !== undefined).toBe(false);
    expect('religion' in view && view.religion !== undefined).toBe(false);
    expect('fatherName' in view && view.fatherName !== undefined).toBe(false);
    expect('passportNumber' in view && view.passportNumber !== undefined).toBe(false);
    // The snapshot the PDF was built from is recorded on the view.
    expect(view.settingsApplied).toEqual(allOff);
  });

  it('defaults: father name ON, religion + passport number OFF (the S7-0 freeze)', () => {
    const view = toResumeView(source, RESUME_SETTINGS_DEFAULTS, null);
    expect(view.fatherName).toBe(FATHER_NAME);
    expect(view.phone).toBe(PHONE);
    expect(view.religion).toBeUndefined();
    expect(view.passportNumber).toBeUndefined();
  });

  it('no video → the video section is ABSENT from the HTML (not an empty placeholder)', () => {
    const html = renderResumeHtml(toResumeView(source, allOn, null));
    expect(html).not.toContain('Video Portfolio');
  });

  // ── SEC-004 (S8-H2): the template must neutralise hostile profile content ──
  describe('SEC-004 — template injection', () => {
    it('escapes script/markup in profile TEXT rather than emitting live markup', () => {
      const hostile = {
        ...source,
        fullName: `<script>alert('pwned')</script>`,
        fatherName: `<img src=x onerror=alert(1)>`,
        currentLocation: `"><svg/onload=alert(2)>`,
        nationality: `</table><h1>INJECTED`,
      };
      const html = renderResumeHtml(toResumeView(hostile, allOn, null));

      for (const live of ['<script>', '<img src=x', '<svg/onload', '</table><h1>']) {
        expect({ marker: live, present: html.includes(live) }).toEqual({ marker: live, present: false });
      }
      // Present in ESCAPED form — proves the content rendered and was
      // neutralised, rather than silently dropped (which would make the
      // assertions above vacuous).
      expect(html).toContain('&lt;script&gt;');
    });

    it('cannot be escaped out of the photo src="" attribute', () => {
      // The photo data-URI is the one value landing in an attribute rather than
      // in text. A quote in it would close src="" and turn the remainder into
      // attributes — a live event handler inside the Chromium render context.
      const html = renderResumeHtml(
        toResumeView(source, allOn, `data:image/png" onload="alert(1)`),
      );
      expect(/<img[^>]*\sonload=/i.test(html)).toBe(false);
    });

    it('still renders a well-formed photo when the data-URI is legitimate', () => {
      const good = 'data:image/png;base64,iVBORw0KGgo=';
      const html = renderResumeHtml(toResumeView(source, allOn, good));
      expect(html).toContain(`src="${good}"`);
    });
  });
});

describe('ResumeRenderService (persistence flow, pool real, DB mocked)', () => {
  function build(overrides: { snapshot?: unknown; language?: string } = {}) {
    const generation = {
      id: 'gen-1',
      resumeId: 'resume-1',
      status: ResumeGenerationStatus.PENDING,
      settingsSnapshot: overrides.snapshot ?? { ...allOn, language: overrides.language ?? 'en' },
      resume: {
        id: 'resume-1',
        candidateId: 'cand-1',
        language: 'en',
        showPhone: true,
        showReligion: false,
        showFatherName: true,
        showPassportNumber: false,
      },
    };
    const prisma = {
      resumeGeneration: {
        findUnique: jest.fn().mockResolvedValue(generation),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      candidateResume: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    };
    const storage = {
      putObject: jest.fn().mockResolvedValue(undefined),
      getObjectBuffer: jest.fn().mockResolvedValue(null),
    };
    const candidateRead = {
      getResumeSource: jest.fn().mockResolvedValue(source),
    } as unknown as CandidateReadService;
    const pdfRender = new PdfRenderService(pool, storage as unknown as StorageService);
    const service = new ResumeRenderService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      candidateRead,
      pdfRender,
    );
    return { service, prisma, storage };
  }

  it('renders → uploads under resumes/{candidateId}/ → marks READY with the snapshot recorded', async () => {
    const { service, prisma, storage } = build();
    const result = await service.renderGeneration('gen-1');

    expect(result.r2Key.startsWith('resumes/cand-1/')).toBe(true);
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringMatching(/^resumes\/cand-1\//),
      expect.any(Buffer),
      'application/pdf',
    );
    const update = prisma.resumeGeneration.update.mock.calls[0][0];
    expect(update.data.status).toBe(ResumeGenerationStatus.READY);
    expect(update.data.r2Key).toBe(result.r2Key);
    expect(update.data.settingsSnapshot).toMatchObject({ showPassportNumber: true });
    expect(prisma.candidateResume.update).toHaveBeenCalled();
  });

  it("language guard: a stray 'hi' still renders (EN template), never crashes or half-renders", async () => {
    const { service, storage } = build({ language: 'hi' });
    await service.renderGeneration('gen-1');
    const bufferArg = (storage.putObject as jest.Mock).mock.calls[0][1] as Buffer;
    expect(await extractText(bufferArg)).toContain('Suresh Kumar'); // rendered, in English
  });

  it('already-READY generation returns without re-rendering (retry idempotence)', async () => {
    const { service, prisma, storage } = build();
    (prisma.resumeGeneration.findUnique as jest.Mock).mockResolvedValue({
      id: 'gen-1',
      resumeId: 'resume-1',
      status: ResumeGenerationStatus.READY,
      r2Key: 'resumes/cand-1/existing.pdf',
      sizeBytes: 123,
      resume: { candidateId: 'cand-1' },
    });
    const result = await service.renderGeneration('gen-1');
    expect(result.r2Key).toBe('resumes/cand-1/existing.pdf');
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('markFailed flips only PENDING rows to FAILED with a generic (PII-free) reason', async () => {
    const { service, prisma } = build();
    await service.markFailed('gen-1');
    expect(prisma.resumeGeneration.updateMany).toHaveBeenCalledWith({
      where: { id: 'gen-1', status: ResumeGenerationStatus.PENDING },
      data: expect.objectContaining({ status: ResumeGenerationStatus.FAILED }),
    });
  });
});

describe('ResumeRenderProcessor (unit)', () => {
  function buildProcessor() {
    const renderService = {
      renderGeneration: jest
        .fn()
        .mockResolvedValue({ resumeId: 'r1', generationId: 'g1', r2Key: 'k', sizeBytes: 9 }),
      markFailed: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResumeRenderService;
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const emitter = new EventEmitter2();
    const processor = new ResumeRenderProcessor(renderService, audit, emitter);
    return { processor, renderService, audit, emitter };
  }

  it('process → renders, audits (ids only), emits resume.generated', async () => {
    const { processor, audit, emitter } = buildProcessor();
    const emitted: unknown[] = [];
    emitter.on(RESUME_EVENTS.GENERATED, (p) => emitted.push(p));

    await processor.process({
      name: 'generate-resume',
      data: { generationId: 'g1', candidateId: 'cand-1' },
    } as never);

    expect(emitted).toEqual([{ candidateId: 'cand-1', resumeId: 'r1', generationId: 'g1' }]);
    const meta = (audit.log as jest.Mock).mock.calls[0][0].meta;
    // Ids + size only — no names, phones, or content.
    expect(Object.keys(meta).sort()).toEqual(['candidateId', 'resumeId', 'sizeBytes']);
  });

  it('onFailed marks FAILED only when retries are exhausted', async () => {
    const { processor, renderService } = buildProcessor();
    await processor.onFailed({
      name: 'generate-resume',
      data: { generationId: 'g1', candidateId: 'c' },
      attemptsMade: 1,
      opts: { attempts: 3 },
    } as never);
    expect(renderService.markFailed).not.toHaveBeenCalled(); // a retry is coming

    await processor.onFailed({
      name: 'generate-resume',
      data: { generationId: 'g1', candidateId: 'c' },
      attemptsMade: 3,
      opts: { attempts: 3 },
    } as never);
    expect(renderService.markFailed).toHaveBeenCalledWith('g1');
  });
});
