import {
  CandidateSkill,
  Currency,
  ExperienceType,
  MaritalStatus,
  WorkExperience,
} from '@prisma/client';
import { toSelf, CandidateProfileWithRelations } from './candidate-self.mapper';

// ─── Factory ──────────────────────────────────────────────────────────────────

function makeProfile(
  overrides: Partial<CandidateProfileWithRelations> = {},
): CandidateProfileWithRelations {
  return {
    id: 'cand-1',
    userId: 'user-1',
    fullName: 'Alice Smith',
    fatherName: 'Bob Smith',
    dob: new Date('1990-06-15'),
    phone: '+911234567890',
    phoneVerifiedAt: new Date('2024-01-01T10:00:00Z'),
    whatsappCapable: true,
    maritalStatus: MaritalStatus.SINGLE,
    religion: 'Hindu',
    languages: ['English', 'Hindi'],
    jobCategoryId: 'cat-1',
    photoKey: 'photos/alice.jpg',
    currentLocation: 'Mumbai, India',
    nationality: 'Indian',
    noticePeriod: '1 month',
    salaryExpectationMin: 50_000,
    salaryExpectationMax: 80_000,
    salaryExpectationCurrency: Currency.INR,
    isAvailable: true,
    profileVisible: true,
    showPhone: true,
    showReligion: false,
    waNotifications: true,
    emailNotifs: true,
    completionPct: 70,
    videoR2Key: null,
    videoDurationSec: null,
    videoSizeBytes: null,
    videoUploadedAt: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-06-01T00:00:00Z'),
    experiences: [],
    skills: [],
    ...overrides,
  } as unknown as CandidateProfileWithRelations;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('toSelf mapper (candidate-self viewer)', () => {
  // ── Self view ignores privacy toggles ──────────────────────────────────────

  it('includes phone even when showPhone = false', () => {
    const dto = toSelf(makeProfile({ showPhone: false }));
    expect(dto.phone).toBe('+911234567890');
  });

  it('includes religion even when showReligion = false', () => {
    const dto = toSelf(makeProfile({ showReligion: false }));
    expect(dto.religion).toBe('Hindu');
  });

  it('exposes showPhone and showReligion flags themselves (for settings UI)', () => {
    const dto = toSelf(makeProfile({ showPhone: false, showReligion: false }));
    expect(dto.showPhone).toBe(false);
    expect(dto.showReligion).toBe(false);
  });

  // ── Date serialisation ─────────────────────────────────────────────────────

  it('serialises dob as YYYY-MM-DD string', () => {
    const dto = toSelf(makeProfile({ dob: new Date('1990-06-15') }));
    expect(dto.dob).toBe('1990-06-15');
  });

  it('maps null dob to null (not throw)', () => {
    const dto = toSelf(makeProfile({ dob: null }));
    expect(dto.dob).toBeNull();
  });

  it('serialises phoneVerifiedAt as ISO string', () => {
    const dto = toSelf(makeProfile({ phoneVerifiedAt: new Date('2024-01-01T10:00:00Z') }));
    expect(dto.phoneVerifiedAt).toBe('2024-01-01T10:00:00.000Z');
  });

  it('maps null phoneVerifiedAt to null', () => {
    const dto = toSelf(makeProfile({ phoneVerifiedAt: null }));
    expect(dto.phoneVerifiedAt).toBeNull();
  });

  it('serialises createdAt and updatedAt as ISO strings', () => {
    const dto = toSelf(makeProfile());
    expect(dto.createdAt).toBe('2024-01-01T00:00:00.000Z');
    expect(dto.updatedAt).toBe('2024-06-01T00:00:00.000Z');
  });

  // ── All scalar fields present ───────────────────────────────────────────────

  it('maps id, userId, fullName, fatherName', () => {
    const dto = toSelf(makeProfile());
    expect(dto.id).toBe('cand-1');
    expect(dto.userId).toBe('user-1');
    expect(dto.fullName).toBe('Alice Smith');
    expect(dto.fatherName).toBe('Bob Smith');
  });

  it('maps completionPct, nationality, currentLocation, noticePeriod', () => {
    const dto = toSelf(makeProfile());
    expect(dto.completionPct).toBe(70);
    expect(dto.nationality).toBe('Indian');
    expect(dto.currentLocation).toBe('Mumbai, India');
    expect(dto.noticePeriod).toBe('1 month');
  });

  it('maps salary fields', () => {
    const dto = toSelf(makeProfile());
    expect(dto.salaryExpectationMin).toBe(50_000);
    expect(dto.salaryExpectationMax).toBe(80_000);
    expect(dto.salaryExpectationCurrency).toBe(Currency.INR);
  });

  // ── Null optional fields don't throw ─────────────────────────────────────

  it('handles all nullable fields being null without throwing', () => {
    expect(() =>
      toSelf(
        makeProfile({
          fatherName: null,
          dob: null,
          phone: null,
          phoneVerifiedAt: null,
          maritalStatus: null,
          religion: null,
          languages: [],
          jobCategoryId: null,
          photoKey: null,
          currentLocation: null,
          nationality: null,
          noticePeriod: null,
          salaryExpectationMin: null,
          salaryExpectationMax: null,
          salaryExpectationCurrency: null,
        }),
      ),
    ).not.toThrow();
  });

  // ── Nested experiences ────────────────────────────────────────────────────

  it('maps experiences array with correct shape', () => {
    const profile = makeProfile({
      experiences: [
        {
          id: 'exp-1',
          candidateId: 'cand-1',
          type: ExperienceType.INDIA,
          country: 'India',
          companyName: 'Acme Corp',
          role: 'Engineer',
          years: 3,
          months: 6,
          startDate: new Date('2020-01-01'),
          endDate: new Date('2023-07-01'),
          createdAt: new Date('2020-01-01T00:00:00Z'),
        } as unknown as WorkExperience,
      ],
    });
    const dto = toSelf(profile);
    expect(dto.experiences).toHaveLength(1);
    const exp = dto.experiences[0]!;
    expect(exp.id).toBe('exp-1');
    expect(exp.companyName).toBe('Acme Corp');
    expect(exp.role).toBe('Engineer');
    expect(exp.years).toBe(3);
    expect(exp.months).toBe(6);
    expect(exp.startDate).toBe('2020-01-01');
    expect(exp.endDate).toBe('2023-07-01');
    expect(exp.createdAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('maps empty experiences array to []', () => {
    const dto = toSelf(makeProfile({ experiences: [] }));
    expect(dto.experiences).toEqual([]);
  });

  it('serialises experience startDate/endDate as YYYY-MM-DD when set', () => {
    const profile = makeProfile({
      experiences: [
        {
          id: 'exp-1',
          candidateId: 'cand-1',
          type: ExperienceType.FOREIGN,
          country: 'Qatar',
          companyName: 'Gulf Co',
          role: 'Welder',
          years: 2,
          months: 0,
          startDate: null,
          endDate: null,
          createdAt: new Date('2021-03-01T00:00:00Z'),
        } as unknown as WorkExperience,
      ],
    });
    const dto = toSelf(profile);
    expect(dto.experiences[0]!.startDate).toBeNull();
    expect(dto.experiences[0]!.endDate).toBeNull();
  });

  // ── Nested skills ─────────────────────────────────────────────────────────

  it('maps skills array with id and name', () => {
    const profile = makeProfile({
      skills: [
        { id: 'sk-1', candidateId: 'cand-1', name: 'Welding' },
        { id: 'sk-2', candidateId: 'cand-1', name: 'Driving' },
      ] as CandidateSkill[],
    });
    const dto = toSelf(profile);
    expect(dto.skills).toHaveLength(2);
    expect(dto.skills[0]!).toEqual({ id: 'sk-1', name: 'Welding' });
    expect(dto.skills[1]!).toEqual({ id: 'sk-2', name: 'Driving' });
  });

  it('maps empty skills array to []', () => {
    const dto = toSelf(makeProfile({ skills: [] }));
    expect(dto.skills).toEqual([]);
  });
});
