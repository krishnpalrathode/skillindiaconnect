/**
 * CR-001 B1 — the template SETTING: what the API accepts, and the single
 * row→settings mapping every read now goes through.
 *
 * DB-free by design. The value here is in the gate and the consolidation, both
 * of which are pure; an integration test would add a container dependency
 * without testing anything these do not.
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CandidateResume, ResumeTemplate } from '@prisma/client';
import {
  ACCEPTED_RESUME_TEMPLATES,
  UpdateResumeSettingsDto,
} from './dto/update-resume-settings.dto';
import { TEMPLATE_REGISTRY } from './templates/registry';
import { toSettings } from './resume-settings.service';
import { RESUME_SETTINGS_DEFAULTS } from './resume-view.mapper';

function validateDto(payload: Record<string, unknown>) {
  return validateSync(plainToInstance(UpdateResumeSettingsDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

function row(overrides: Partial<CandidateResume> = {}): CandidateResume {
  return {
    id: 'res-1',
    candidateId: 'cand-1',
    language: 'en',
    showPhone: true,
    showReligion: false,
    showFatherName: true,
    showPassportNumber: false,
    template: ResumeTemplate.CLASSIC,
    publicSlug: null,
    visibility: 'DISABLED',
    lastRenderHash: null,
    lastRenderKey: null,
    lastRenderedAt: null,
    updatedAt: new Date(),
    ...overrides,
  } as CandidateResume;
}

describe('defaults', () => {
  it('CLASSIC is the default template', () => {
    // Not MODERN: defaulting to a new look would silently change the appearance
    // of resumes candidates have already sent to employers.
    expect(RESUME_SETTINGS_DEFAULTS.template).toBe(ResumeTemplate.CLASSIC);
  });
});

describe('toSettings — THE row→settings mapping', () => {
  it('carries the template off the row', () => {
    expect(toSettings(row()).template).toBe(ResumeTemplate.CLASSIC);
    expect(toSettings(row({ template: ResumeTemplate.MODERN })).template).toBe(
      ResumeTemplate.MODERN,
    );
  });

  it('returns every setting the render pipeline needs', () => {
    // Exhaustive: this is the one place the mapping is defined, so a field
    // added to ResumeRenderSettings and forgotten here fails right away rather
    // than surfacing as a settings read that disagrees with what rendered.
    expect(Object.keys(toSettings(row())).sort()).toEqual(
      Object.keys(RESUME_SETTINGS_DEFAULTS).sort(),
    );
  });
});

describe('UpdateResumeSettingsDto — the honest-contract gate', () => {
  it('accepts CLASSIC', () => {
    expect(validateDto({ template: ResumeTemplate.CLASSIC })).toHaveLength(0);
  });

  it('accepts an update that omits template entirely (partial PATCH)', () => {
    expect(validateDto({ showPhone: false })).toHaveLength(0);
  });

  it.each([ResumeTemplate.MODERN, ResumeTemplate.COMPACT, ResumeTemplate.MINIMAL])(
    'accepts %s — B2 shipped its renderer',
    (template) => {
      expect(validateDto({ template })).toHaveLength(0);
    },
  );

  it('rejects an unknown string', () => {
    expect(validateDto({ template: 'HOLOGRAPHIC' })).toHaveLength(1);
  });

  /**
   * THE DURABLE RULE, stated structurally rather than as a list.
   *
   * B1 asserted "MODERN is rejected", which was true then and became wrong the
   * moment B2 shipped its renderer — a test that encodes a snapshot of the
   * roadmap has to be rewritten every time the roadmap moves, and rewriting it
   * is indistinguishable from deleting the guarantee.
   *
   * What actually matters is the INVARIANT the `language: enum [en]` precedent
   * expresses: never accept a value that would quietly render as something
   * else. That holds for any future template without an edit.
   */
  it('every ACCEPTED template has a real renderer behind it', () => {
    for (const template of ACCEPTED_RESUME_TEMPLATES) {
      expect(typeof TEMPLATE_REGISTRY[template]).toBe('function');
    }
  });

  it('a template with no renderer could never be accepted', () => {
    const registered = Object.keys(TEMPLATE_REGISTRY);
    for (const template of ACCEPTED_RESUME_TEMPLATES) {
      expect(registered).toContain(template);
    }
  });
});
