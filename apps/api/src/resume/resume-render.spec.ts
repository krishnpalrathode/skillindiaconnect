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
import { ResumeGenerationStatus } from '@prisma/client';
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
  skills: [{ name: 'Panel Installation' }, { name: 'Circuit Testing' }],
  documents: [
    { type: 'PASSPORT', expiryDate: new Date('2031-01-01'), documentNumber: PASSPORT_NUMBER },
    { type: 'EXPERIENCE_CERT', expiryDate: null, documentNumber: null },
  ],
};

const allOn: ResumeRenderSettings = {
  language: 'en',
  showPhone: true,
  showReligion: true,
  showFatherName: true,
  showPassportNumber: true,
};
const allOff: ResumeRenderSettings = {
  language: 'en',
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

async function renderToText(settings: ResumeRenderSettings): Promise<string> {
  const view = toResumeView(source, settings, null);
  const buffer = await pool.render(renderResumeHtml(view));
  return extractText(buffer);
}

describe('settings-driven omission — IN THE PDF BYTES', () => {
  it('all toggles ON → passport number, religion, phone, father name are all PRESENT in the extracted text', async () => {
    const text = await renderToText(allOn);
    expect(text).toContain(PASSPORT_NUMBER);
    expect(text).toContain(RELIGION);
    expect(text).toContain(PHONE);
    expect(text).toContain(FATHER_NAME);
    // Sanity: the unconditional content rendered too.
    expect(text).toContain('Suresh Kumar');
    expect(text).toContain('Gulf Wiring LLC');
  });

  it('all toggles OFF → each value is ABSENT FROM THE BYTES (not merely hidden)', async () => {
    const text = await renderToText(allOff);
    expect(text).not.toContain(PASSPORT_NUMBER);
    expect(text).not.toContain(RELIGION);
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain(FATHER_NAME);
    // The labels vanish with the values — no empty "Passport number:" row.
    expect(text).not.toContain('Passport number');
    expect(text).not.toContain('Religion');
    expect(text).not.toContain("Father's name");
    // The resume is still a resume.
    expect(text).toContain('Suresh Kumar');
    expect(text).toContain('suresh@example.com');
  });

  it('each toggle omits ONLY its own field (passport-number case, the one that matters most)', async () => {
    const text = await renderToText({ ...allOn, showPassportNumber: false });
    expect(text).not.toContain(PASSPORT_NUMBER);
    expect(text).toContain(RELIGION);
    expect(text).toContain(PHONE);
    expect(text).toContain(FATHER_NAME);
    // The documents SUMMARY still lists the passport (validity, no number).
    expect(text).toContain('Passport');
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
