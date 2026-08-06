/**
 * CR-WA W0 — the template-variable seam.
 *
 * Before this, notification.processor.ts called
 *   sendTemplate(phone, templateKey, {})
 * with an EMPTY payload. The mock ignored it, so nothing ever failed. The
 * approved Meta templates take parameters (job_selected takes three), and Meta
 * rejects a mismatched parameter count — so every real send would have failed
 * on day one, in a way that looks like a template-approval problem.
 *
 * What these tests defend, in order of how expensive each is to get wrong:
 *
 *  1. THE ORDER. Meta's parameters are positional. A swapped pair produces a
 *     message that reads perfectly and says something false — "selected for
 *     Gulf Wiring LLC at Senior Electrician" — and it cannot be unsent.
 *  2. NO PLACEHOLDERS. Unresolvable data must FAIL the send, not produce
 *     "You have been selected for  at ".
 *  3. The document carries real BYTES, resolved at send time.
 */
import { Logger } from '@nestjs/common';
import {
  readDocumentKey,
  readTemplateVars,
  WA_DOCUMENT_KEY,
  WA_TEMPLATE_VARS_KEY,
} from './notification.types';
import { MockWhatsappChannel } from './channels/whatsapp.mock';
import { resolveSelectedTemplateVars } from '../applications/selected-template-vars';
import type { JobsService } from '../jobs/jobs.service';
import type { CandidateReadService } from '../candidate/candidate-read.service';

const JOB_ID = 'job-1';
const CANDIDATE_ID = 'cand-1';

function makeDeps(overrides?: {
  job?: { title: string; companyName: string } | undefined;
  name?: string | undefined;
  throws?: boolean;
}) {
  const jobsService = {
    getJobSubsets: jest.fn().mockImplementation(async () => {
      if (overrides?.throws) throw new Error('jobs unavailable');
      const job = overrides && 'job' in overrides ? overrides.job : { title: 'Senior Electrician', companyName: 'Gulf Wiring LLC' };
      return job ? new Map([[JOB_ID, { id: JOB_ID, ...job }]]) : new Map();
    }),
  } as unknown as JobsService;

  const candidateRead = {
    getNamesByIds: jest.fn().mockImplementation(async () => {
      const name = overrides && 'name' in overrides ? overrides.name : 'Suresh Kumar';
      return name ? new Map([[CANDIDATE_ID, name]]) : new Map();
    }),
  } as unknown as CandidateReadService;

  return { jobsService, candidateRead, logger: new Logger('spec') };
}

describe('resolveSelectedTemplateVars — THE ORDER IS THE CONTRACT', () => {
  it('returns [name, jobTitle, company] in EXACTLY that order', async () => {
    const vars = await resolveSelectedTemplateVars(makeDeps(), JOB_ID, CANDIDATE_ID);
    // Asserted positionally, not by membership: job_selected is {{1}} name,
    // {{2}} title, {{3}} company. Membership would pass on a swapped pair.
    expect(vars).toEqual(['Suresh Kumar', 'Senior Electrician', 'Gulf Wiring LLC']);
    expect(vars?.[0]).toBe('Suresh Kumar');
    expect(vars?.[1]).toBe('Senior Electrician');
    expect(vars?.[2]).toBe('Gulf Wiring LLC');
  });

  it('supplies exactly three parameters — the approved template takes three', async () => {
    const vars = await resolveSelectedTemplateVars(makeDeps(), JOB_ID, CANDIDATE_ID);
    expect(vars).toHaveLength(3);
  });

  it.each([
    ['the job is missing', { job: undefined }],
    ['the candidate name is missing', { name: undefined }],
    ['the lookup throws', { throws: true }],
  ])('returns NULL when %s — never a partial row', async (_label, o) => {
    // null makes the caller omit the params, which makes the worker fail the
    // send honestly and fall back to email. A partial array would send
    // "selected for  at ".
    expect(await resolveSelectedTemplateVars(makeDeps(o), JOB_ID, CANDIDATE_ID)).toBeNull();
  });

  it('returns null for a purged candidate (no candidateId)', async () => {
    expect(await resolveSelectedTemplateVars(makeDeps(), JOB_ID, null)).toBeNull();
  });

  it('never throws — a committed transition must not become a 500', async () => {
    await expect(
      resolveSelectedTemplateVars(makeDeps({ throws: true }), JOB_ID, CANDIDATE_ID),
    ).resolves.toBeNull();
  });
});

describe('payload readers — malformed data is rejected, not coerced', () => {
  it('reads a well-formed ordered array', () => {
    expect(readTemplateVars({ [WA_TEMPLATE_VARS_KEY]: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it.each([
    ['absent', undefined],
    ['empty data', {}],
    ['not an array', { [WA_TEMPLATE_VARS_KEY]: 'a,b' }],
    ['array of non-strings', { [WA_TEMPLATE_VARS_KEY]: [1, 2] }],
    ['array with a null', { [WA_TEMPLATE_VARS_KEY]: ['a', null] }],
  ])('returns null for %s', (_label, data) => {
    // null → the processor fails the send. Coercing would put "null" or
    // "[object Object]" into a message a candidate reads.
    expect(readTemplateVars(data as Record<string, unknown> | undefined)).toBeNull();
  });

  it('reads a document key, and rejects an empty one', () => {
    expect(readDocumentKey({ [WA_DOCUMENT_KEY]: 'resumes/c/r.pdf' })).toBe('resumes/c/r.pdf');
    expect(readDocumentKey({ [WA_DOCUMENT_KEY]: '' })).toBeNull();
    expect(readDocumentKey({})).toBeNull();
  });
});

describe('MockWhatsappChannel records what it was given', () => {
  it('captures the ordered params so tests can assert on them', async () => {
    const wa = new MockWhatsappChannel();
    await wa.sendTemplate('+919876543210', 'wa.selected', {
      bodyParams: ['Suresh Kumar', 'Senior Electrician', 'Gulf Wiring LLC'],
    });
    const send = wa.getLastTemplateSend('+919876543210', 'wa.selected');
    expect(send?.bodyParams).toEqual(['Suresh Kumar', 'Senior Electrician', 'Gulf Wiring LLC']);
    expect(send?.document).toBeUndefined();
  });

  it('captures an attached document with its bytes', async () => {
    const wa = new MockWhatsappChannel();
    await wa.sendTemplate('+919876543210', 'wa.resume_doc', {
      bodyParams: ['Suresh Kumar'],
      document: {
        filename: 'Suresh-Kumar-Resume.pdf',
        bytes: Buffer.from('%PDF-1.4 fake'),
        mimeType: 'application/pdf',
      },
    });
    const send = wa.getLastTemplateSend('+919876543210', 'wa.resume_doc');
    expect(send?.document?.filename).toBe('Suresh-Kumar-Resume.pdf');
    expect(send?.document?.bytes.length).toBeGreaterThan(0);
  });
});
