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
import { UpdateResumeSettingsDto } from './dto/update-resume-settings.dto';
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
    'REJECTS %s — declared in the DB enum but it has no renderer yet',
    (template) => {
      // The same rule `language` applies to hi/ar: accepting a value that would
      // quietly render as something else is worse than refusing it. B2 widens
      // this list as it ships the renderers.
      const errors = validateDto({ template });
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('template');
    },
  );

  it('rejects an unknown string', () => {
    expect(validateDto({ template: 'HOLOGRAPHIC' })).toHaveLength(1);
  });
});
