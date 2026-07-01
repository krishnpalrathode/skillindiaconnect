// Integration tests (CompletionService class) need a real DB container.
jest.setTimeout(180_000);

import { compute, CompletionInput, CompletionProfileInput } from './completion.service';
import { WEIGHTS } from './completion.constants';

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const emptyProfile: CompletionProfileInput = {
  photoKey: null,
  fullName: '',
  fatherName: null,
  dob: null,
  phoneVerifiedAt: null,
  maritalStatus: null,
  languages: [],
  jobCategoryId: null,
  currentLocation: null,
  nationality: null,
};

const fullProfile: CompletionProfileInput = {
  photoKey: 'photo.jpg',
  fullName: 'John Doe',
  fatherName: 'John Senior',
  dob: new Date('1990-01-01'),
  phoneVerifiedAt: new Date(),
  maritalStatus: 'SINGLE',
  languages: ['English', 'Hindi'],
  jobCategoryId: 'cat-1',
  currentLocation: 'Mumbai, India',
  nationality: 'Indian',
};

function baseInput(overrides: Partial<CompletionInput> = {}): CompletionInput {
  return {
    profile: emptyProfile,
    experiences: [],
    skillCount: 0,
    mandatoryDocTypesPresent: [],
    mandatoryDocCount: 3,
    ...overrides,
  };
}

// â”€â”€â”€ Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('compute (pure scoring function)', () => {
  // â”€â”€ Empty / zero state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('empty profile â†’ pct = 0', () => {
    expect(compute(baseInput()).pct).toBe(0);
  });

  it('empty profile â†’ all sections at 0', () => {
    const { sections } = compute(baseInput());
    expect(sections.every((s) => s.pct === 0)).toBe(true);
    expect(sections.every((s) => s.complete === false)).toBe(true);
  });

  // â”€â”€ Personal info: each field adds exactly 4% â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const personalInfoCases: Array<[string, Partial<CompletionProfileInput>]> = [
    ['photo', { photoKey: 'photo.jpg' }],
    ['fullName', { fullName: 'Jane' }],
    ['fatherName', { fatherName: 'Dad' }],
    ['dob', { dob: new Date('1990-01-01') }],
    ['verifiedPhone (phoneVerifiedAt)', { phoneVerifiedAt: new Date() }],
    ['maritalStatus', { maritalStatus: 'SINGLE' }],
    ['languages (â‰¥1)', { languages: ['English'] }],
    ['jobCategoryId', { jobCategoryId: 'cat-1' }],
    ['currentLocation', { currentLocation: 'Mumbai' }],
    ['nationality', { nationality: 'Indian' }],
  ];

  it.each(personalInfoCases)('personal info: %s adds exactly 4%', (_label, profileOverride) => {
    const result = compute(baseInput({ profile: { ...emptyProfile, ...profileOverride } }));
    expect(result.pct).toBe(WEIGHTS.personalInfoPerField);
    const piSection = result.sections.find((s) => s.key === 'personalInfo');
    expect(piSection?.pct).toBe(WEIGHTS.personalInfoPerField);
  });

  it('all 10 personal-info fields filled â†’ piSection.pct = 40', () => {
    const result = compute(baseInput({ profile: fullProfile }));
    const piSection = result.sections.find((s) => s.key === 'personalInfo');
    expect(piSection?.pct).toBe(40);
    expect(piSection?.complete).toBe(true);
  });

  // â”€â”€ Religion / noticePeriod are UNSCORED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('religion set does NOT change pct', () => {
    const without = compute(baseInput({ profile: { ...emptyProfile, religion: undefined } }));
    const withReligion = compute(baseInput({ profile: { ...emptyProfile, religion: 'Hindu' } }));
    expect(withReligion.pct).toBe(without.pct);
  });

  it('noticePeriod set does NOT change pct', () => {
    const without = compute(baseInput({ profile: { ...emptyProfile, noticePeriod: undefined } }));
    const withNotice = compute(
      baseInput({ profile: { ...emptyProfile, noticePeriod: '1 month' } }),
    );
    expect(withNotice.pct).toBe(without.pct);
  });

  // â”€â”€ Phone verification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('unverified phone (phoneVerifiedAt = null) does NOT score', () => {
    const result = compute(baseInput({ profile: { ...emptyProfile, phoneVerifiedAt: null } }));
    const piSection = result.sections.find((s) => s.key === 'personalInfo');
    expect(piSection?.pct).toBe(0);
  });

  it('phoneVerifiedAt set adds exactly 4%', () => {
    const result = compute(
      baseInput({ profile: { ...emptyProfile, phoneVerifiedAt: new Date() } }),
    );
    expect(result.pct).toBe(4);
  });

  // â”€â”€ Languages edge case â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('empty languages array does NOT score', () => {
    const result = compute(baseInput({ profile: { ...emptyProfile, languages: [] } }));
    const piSection = result.sections.find((s) => s.key === 'personalInfo');
    expect(piSection?.pct).toBe(0);
  });

  it('one language scores the field (â‰¥1 required)', () => {
    const result = compute(baseInput({ profile: { ...emptyProfile, languages: ['English'] } }));
    expect(result.pct).toBe(4);
  });

  // â”€â”€ Work experience â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const completeExp = {
    type: 'INDIA',
    country: 'India',
    companyName: 'Acme Corp',
    role: 'Engineer',
    years: 2,
  };

  it('one complete experience = 20% in the experience section', () => {
    const result = compute(baseInput({ experiences: [completeExp] }));
    const expSection = result.sections.find((s) => s.key === 'experience');
    expect(expSection?.pct).toBe(20);
    expect(expSection?.complete).toBe(true);
  });

  it('incomplete entry (missing role = empty string) = 0 experience pct', () => {
    const result = compute(baseInput({ experiences: [{ ...completeExp, role: '' }] }));
    const expSection = result.sections.find((s) => s.key === 'experience');
    expect(expSection?.pct).toBe(0);
    expect(expSection?.complete).toBe(false);
  });

  it('incomplete entry (missing companyName) = 0 experience pct', () => {
    const result = compute(baseInput({ experiences: [{ ...completeExp, companyName: '' }] }));
    const expSection = result.sections.find((s) => s.key === 'experience');
    expect(expSection?.pct).toBe(0);
  });

  it('two entries, first incomplete, second complete â†’ still 20%', () => {
    const result = compute(
      baseInput({
        experiences: [{ ...completeExp, role: '' }, completeExp],
      }),
    );
    const expSection = result.sections.find((s) => s.key === 'experience');
    expect(expSection?.pct).toBe(20);
  });

  it('no experiences â†’ experience section complete = false', () => {
    const result = compute(baseInput({ experiences: [] }));
    const expSection = result.sections.find((s) => s.key === 'experience');
    expect(expSection?.complete).toBe(false);
  });

  // â”€â”€ Documents (settings-driven N) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe('documents with N=3 (MVP default)', () => {
    it('0 of 3 docs â†’ 0%', () => {
      const result = compute(baseInput({ mandatoryDocTypesPresent: [], mandatoryDocCount: 3 }));
      const docSection = result.sections.find((s) => s.key === 'documents');
      expect(docSection?.pct).toBe(0);
    });

    it('1 of 3 docs (PASSPORT) â†’ 10%', () => {
      const result = compute(
        baseInput({ mandatoryDocTypesPresent: ['PASSPORT'], mandatoryDocCount: 3 }),
      );
      const docSection = result.sections.find((s) => s.key === 'documents');
      expect(docSection?.pct).toBe(10);
    });

    it('2 of 3 docs â†’ 20%', () => {
      const result = compute(
        baseInput({
          mandatoryDocTypesPresent: ['PASSPORT', 'EXPERIENCE_CERT'],
          mandatoryDocCount: 3,
        }),
      );
      const docSection = result.sections.find((s) => s.key === 'documents');
      expect(docSection?.pct).toBe(20);
    });

    it('3 of 3 docs â†’ 30% (complete)', () => {
      const result = compute(
        baseInput({
          mandatoryDocTypesPresent: ['PASSPORT', 'EXPERIENCE_CERT', 'EDUCATIONAL_CERT'],
          mandatoryDocCount: 3,
        }),
      );
      const docSection = result.sections.find((s) => s.key === 'documents');
      expect(docSection?.pct).toBe(30);
      expect(docSection?.complete).toBe(true);
    });
  });

  describe('documents with N=4 (Phase-2 simulation â€” proves denominator is settings-driven)', () => {
    it('1 of 4 docs â†’ 7.5%', () => {
      const result = compute(
        baseInput({ mandatoryDocTypesPresent: ['PASSPORT'], mandatoryDocCount: 4 }),
      );
      const docSection = result.sections.find((s) => s.key === 'documents');
      expect(docSection?.pct).toBe(7.5);
    });

    it('2 of 4 docs â†’ 15%', () => {
      const result = compute(
        baseInput({
          mandatoryDocTypesPresent: ['PASSPORT', 'EXPERIENCE_CERT'],
          mandatoryDocCount: 4,
        }),
      );
      const docSection = result.sections.find((s) => s.key === 'documents');
      expect(docSection?.pct).toBe(15);
    });

    it('4 of 4 docs â†’ 30% (complete)', () => {
      const result = compute(
        baseInput({
          mandatoryDocTypesPresent: [
            'PASSPORT',
            'EXPERIENCE_CERT',
            'EDUCATIONAL_CERT',
            'WORKING_VIDEO',
          ],
          mandatoryDocCount: 4,
        }),
      );
      const docSection = result.sections.find((s) => s.key === 'documents');
      expect(docSection?.pct).toBe(30);
      expect(docSection?.complete).toBe(true);
    });
  });

  // â”€â”€ Skills (capped at 3) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('0 skills â†’ 0%', () => {
    const result = compute(baseInput({ skillCount: 0 }));
    const skillSection = result.sections.find((s) => s.key === 'skills');
    expect(skillSection?.pct).toBe(0);
  });

  it('1 skill â†’ â‰ˆ3.33% (10/3)', () => {
    const result = compute(baseInput({ skillCount: 1 }));
    const skillSection = result.sections.find((s) => s.key === 'skills');
    expect(skillSection?.pct).toBeCloseTo(10 / 3, 5);
  });

  it('2 skills â†’ â‰ˆ6.67% (20/3)', () => {
    const result = compute(baseInput({ skillCount: 2 }));
    const skillSection = result.sections.find((s) => s.key === 'skills');
    expect(skillSection?.pct).toBeCloseTo(20 / 3, 5);
  });

  it('3 skills â†’ 10% (complete)', () => {
    const result = compute(baseInput({ skillCount: 3 }));
    const skillSection = result.sections.find((s) => s.key === 'skills');
    expect(skillSection?.pct).toBe(10);
    expect(skillSection?.complete).toBe(true);
  });

  it('4 skills â†’ still 10% (cap enforced)', () => {
    const result = compute(baseInput({ skillCount: 4 }));
    const skillSection = result.sections.find((s) => s.key === 'skills');
    expect(skillSection?.pct).toBe(10);
    expect(skillSection?.complete).toBe(true);
  });

  it('10 skills â†’ still 10% (cap enforced at any count)', () => {
    const result = compute(baseInput({ skillCount: 10 }));
    const skillSection = result.sections.find((s) => s.key === 'skills');
    expect(skillSection?.pct).toBe(10);
  });

  // â”€â”€ Total pct is rounded and capped at 100 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('total pct is rounded to nearest integer', () => {
    // 1 skill = 10/3 â‰ˆ 3.333â€¦ â†’ total rounds to 3
    const result = compute(baseInput({ skillCount: 1 }));
    expect(Number.isInteger(result.pct)).toBe(true);
    expect(result.pct).toBe(3);
  });

  it('total pct does not exceed 100 even on overflow input', () => {
    // Artificially add extra doc types to test the cap
    const result = compute(
      baseInput({
        profile: fullProfile,
        experiences: [completeExp],
        skillCount: 10,
        mandatoryDocTypesPresent: [
          'PASSPORT',
          'EXPERIENCE_CERT',
          'EDUCATIONAL_CERT',
          'EXTRA1',
          'EXTRA2',
          'EXTRA3',
        ],
        mandatoryDocCount: 3,
      }),
    );
    expect(result.pct).toBe(100);
  });

  // â”€â”€ Canonical worked example (spec Â§6) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('canonical: full PI (40) + 1 complete experience (20) + PASSPORT only N=3 (10) = 70%', () => {
    const result = compute({
      profile: fullProfile,
      experiences: [completeExp],
      skillCount: 0,
      mandatoryDocTypesPresent: ['PASSPORT'],
      mandatoryDocCount: 3,
    });
    expect(result.pct).toBe(70);

    const sections = Object.fromEntries(result.sections.map((s) => [s.key, s.pct]));
    expect(sections['personalInfo']).toBe(40);
    expect(sections['experience']).toBe(20);
    expect(sections['documents']).toBe(10);
    expect(sections['skills']).toBe(0);
  });

  // â”€â”€ Section shape â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('returns exactly 4 sections with the expected keys', () => {
    const { sections } = compute(baseInput());
    const keys = sections.map((s) => s.key);
    expect(keys).toEqual(['personalInfo', 'experience', 'documents', 'skills']);
  });

  it('each section has key, label, pct, and complete', () => {
    const { sections } = compute(baseInput());
    for (const section of sections) {
      expect(typeof section.key).toBe('string');
      expect(typeof section.label).toBe('string');
      expect(typeof section.pct).toBe('number');
      expect(typeof section.complete).toBe('boolean');
    }
  });
});

// â”€â”€â”€ CompletionService integration (DB wrapper) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Tests the orchestration layer: load from DB â†’ compute â†’ persist completionPct.
// Requires Docker; guarded by dockerUnavailable flag.

import { PrismaClient, UserRole, UserStatus, DocumentType, ExperienceType } from '@prisma/client';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { execSync } from 'child_process';
import * as path from 'path';
import { CompletionService } from './completion.service';
import { PrismaService } from '../../core/prisma/prisma.service';

const CS_API_DIR = path.resolve(__dirname, '../../..');

let csPg: StartedTestContainer;
let csPrisma: PrismaClient;
let csService: CompletionService;
let csDockerUnavailable = false;

describe('CompletionService â€” integration (real DB)', () => {
  beforeAll(async () => {
    try {
      csPg = await new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_USER: 'sic',
          POSTGRES_PASSWORD: 'sic',
          POSTGRES_DB: 'sic_test',
        })
        .withExposedPorts(5432)
        .start();

      const url = `postgresql://sic:sic@localhost:${csPg.getMappedPort(5432)}/sic_test`;

      execSync('pnpm exec prisma migrate deploy', {
        cwd: CS_API_DIR,
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      });

      csPrisma = new PrismaClient({ datasources: { db: { url } } });
      await csPrisma.$connect();
      csService = new CompletionService(csPrisma as unknown as PrismaService);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('container runtime') ||
        msg.includes('Docker') ||
        msg.includes('ENOENT') ||
        msg.includes('connect ECONNREFUSED') ||
        msg.includes('not recognized') ||
        msg.includes('prisma: command not found')
      ) {
        csDockerUnavailable = true;
        console.warn(
          '[integration] Docker or infra unavailable â€” CompletionService integration skipped:',
          msg,
        );
      } else {
        throw err;
      }
    }
  });

  afterAll(async () => {
    await csPrisma?.$disconnect();
    await csPg?.stop();
  });

  beforeEach(async () => {
    if (csDockerUnavailable) return;
    await csPrisma.user.deleteMany();
    await csPrisma.setting.deleteMany();
  });

  // â”€â”€ Factories â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function csUser() {
    return csPrisma.user.create({
      data: {
        email: `u-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
        role: UserRole.CANDIDATE,
        status: UserStatus.ACTIVE,
      },
    });
  }

  async function csCandidate(userId: string, overrides: Record<string, unknown> = {}) {
    return csPrisma.candidateProfile.create({ data: { userId, fullName: '', ...overrides } });
  }

  async function csDoc(candidateId: string, type: DocumentType, expiryDate: Date | null = null) {
    return csPrisma.candidateDocument.create({
      data: {
        candidateId,
        type,
        r2Key: `docs/${type}.pdf`,
        fileName: `${type}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        expiryDate,
      },
    });
  }

  // â”€â”€ getMandatoryDocCount â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('getMandatoryDocCount: returns MVP_MANDATORY_DOC_COUNT (3) when no setting row exists', async () => {
    if (csDockerUnavailable) return;
    const count = await csService.getMandatoryDocCount();
    expect(count).toBe(3);
  });

  it('getMandatoryDocCount: returns array length when setting value is a JSON array', async () => {
    if (csDockerUnavailable) return;
    await csPrisma.setting.create({
      data: {
        key: 'candidates.mandatory_documents',
        value: ['PASSPORT', 'EXPERIENCE_CERT'],
        isCoreRule: false,
      },
    });
    const count = await csService.getMandatoryDocCount();
    expect(count).toBe(2);
  });

  it('getMandatoryDocCount: returns the numeric value when setting value is a number', async () => {
    if (csDockerUnavailable) return;
    await csPrisma.setting.create({
      data: { key: 'candidates.mandatory_documents', value: 4, isCoreRule: false },
    });
    const count = await csService.getMandatoryDocCount();
    expect(count).toBe(4);
  });

  // â”€â”€ recomputeForCandidate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('recomputeForCandidate: persists completionPct = 0 for an empty profile', async () => {
    if (csDockerUnavailable) return;
    const { id: userId } = await csUser();
    const { id: candidateId } = await csCandidate(userId);

    const result = await csService.recomputeForCandidate(candidateId);

    expect(result.pct).toBe(0);
    const row = await csPrisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(row!.completionPct).toBe(0);
  });

  it('recomputeForCandidate: persisted value matches compute() output for same inputs', async () => {
    if (csDockerUnavailable) return;
    const { id: userId } = await csUser();
    const { id: candidateId } = await csCandidate(userId, {
      fullName: 'Alice',
      nationality: 'Indian',
    });
    await csPrisma.workExperience.create({
      data: {
        candidateId,
        type: ExperienceType.INDIA,
        country: 'India',
        companyName: 'Acme',
        role: 'Eng',
        years: 2,
        months: 0,
      },
    });

    const result = await csService.recomputeForCandidate(candidateId);

    // fullName (4) + nationality (4) = 8 PI + 20 exp = 28
    expect(result.pct).toBe(28);
    const row = await csPrisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(row!.completionPct).toBe(28);
  });

  it('recomputeForCandidate: uses mandatory doc types from candidate_documents (N=3 default)', async () => {
    if (csDockerUnavailable) return;
    const { id: userId } = await csUser();
    const { id: candidateId } = await csCandidate(userId);

    // Seed 2 of 3 mandatory doc types â†’ doc score = 30/3 * 2 = 20
    await csDoc(candidateId, DocumentType.PASSPORT);
    await csDoc(candidateId, DocumentType.EXPERIENCE_CERT);

    const result = await csService.recomputeForCandidate(candidateId);

    const docSection = result.sections.find((s) => s.key === 'documents');
    expect(docSection?.pct).toBe(20);
    const row = await csPrisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(row!.completionPct).toBe(20);
  });

  it('recomputeForCandidate: uses settings-driven N (array length) when setting is present', async () => {
    if (csDockerUnavailable) return;
    // Seed N=2 via settings array
    await csPrisma.setting.create({
      data: {
        key: 'candidates.mandatory_documents',
        value: ['PASSPORT', 'EXPERIENCE_CERT'],
        isCoreRule: false,
      },
    });

    const { id: userId } = await csUser();
    const { id: candidateId } = await csCandidate(userId);

    // 1 doc present, N=2 â†’ doc score = 30/2 * 1 = 15
    await csDoc(candidateId, DocumentType.PASSPORT);

    const result = await csService.recomputeForCandidate(candidateId);

    const docSection = result.sections.find((s) => s.key === 'documents');
    expect(docSection?.pct).toBe(15);
    const row = await csPrisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(row!.completionPct).toBe(15);
  });

  it('recomputeForCandidate: is idempotent â€” same inputs produce same stored value on repeated calls', async () => {
    if (csDockerUnavailable) return;
    const { id: userId } = await csUser();
    const { id: candidateId } = await csCandidate(userId, { fullName: 'Bob' });

    const first = await csService.recomputeForCandidate(candidateId);
    const second = await csService.recomputeForCandidate(candidateId);

    expect(second.pct).toBe(first.pct);
    const row = await csPrisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(row!.completionPct).toBe(first.pct);
  });

  it('recomputeForCandidate: WORKING_VIDEO doc type is not counted (not in MVP mandatory list)', async () => {
    if (csDockerUnavailable) return;
    const { id: userId } = await csUser();
    const { id: candidateId } = await csCandidate(userId);

    // WORKING_VIDEO is DocumentType but NOT in MVP_MANDATORY_DOC_TYPES
    await csDoc(candidateId, DocumentType.WORKING_VIDEO);

    const result = await csService.recomputeForCandidate(candidateId);
    const docSection = result.sections.find((s) => s.key === 'documents');
    expect(docSection?.pct).toBe(0);
  });
});

