/**
 * Mapper privacy tests — assertions run on JSON.stringify output, NOT rendered UI.
 *
 * The single most important invariant: showPhone=false → 'phone' KEY ABSENT from
 * the serialized JSON. A value of null/undefined that JSON.stringify omits is NOT
 * sufficient — the key itself must not appear in the stringified object.
 *
 * All tests that depend on toggle-driven omission must use:
 *   'phone' in JSON.parse(JSON.stringify(result))
 * not:
 *   result.phone === undefined  ← hides the difference in TS/JS object semantics
 */

import { DocumentType, ExperienceType } from '@prisma/client';
import { toEmployerView, EmployerViewSource } from './candidate-employer-view.mapper';

// ── Fixture builder ───────────────────────────────────────────────────────────

function makeSource(overrides: Partial<EmployerViewSource> = {}): EmployerViewSource {
  return {
    id: 'cand-uuid',
    userId: 'user-uuid',
    fullName: 'Ravi Kumar',
    dob: new Date('1990-06-15'),
    phone: '+919876543210',
    religion: 'Hindu',
    languages: ['en', 'hi'],
    jobCategoryId: 'cat-uuid',
    photoKey: null,
    photoUrl: null,
    currentLocation: 'Mumbai',
    nationality: 'Indian',
    noticePeriod: 30,
    salaryExpectationMin: 50000,
    salaryExpectationMax: 80000,
    salaryExpectationCurrency: 'INR' as const,
    isAvailable: true,
    completionPct: 85,
    showPhone: true,
    showReligion: false,
    createdAt: new Date('2024-01-15'),
    experiences: [
      {
        id: 'exp-1',
        type: ExperienceType.INDIA,
        country: 'India',
        companyName: 'ACME Corp',
        role: 'Electrician',
        years: 3,
        months: 6,
        startDate: new Date('2020-01-01'),
        endDate: new Date('2023-06-30'),
      },
    ],
    skills: [{ id: 'sk-1', name: 'Welding' }],
    documents: [],
    ...overrides,
  };
}

// ── Section 1: Toggle-driven key omission ─────────────────────────────────────

describe('toEmployerView — phone toggle', () => {
  it('showPhone=true → phone key IS PRESENT in JSON', () => {
    const result = toEmployerView(makeSource({ showPhone: true, phone: '+919876543210' }));
    const json = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect('phone' in json).toBe(true);
    expect(json['phone']).toBe('+919876543210');
  });

  it('showPhone=false → phone key IS ABSENT from JSON (not null, not undefined — absent)', () => {
    const result = toEmployerView(makeSource({ showPhone: false, phone: '+919876543210' }));
    const json = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    // This is the critical assertion: the KEY must not exist
    expect('phone' in json).toBe(false);
  });

  it('showPhone=true but phone is null → phone key absent (nothing to show)', () => {
    const result = toEmployerView(makeSource({ showPhone: true, phone: null }));
    const json = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect('phone' in json).toBe(false);
  });
});

describe('toEmployerView — religion toggle', () => {
  it('showReligion=false → religion key IS ABSENT from JSON (default — most candidates)', () => {
    const result = toEmployerView(makeSource({ showReligion: false, religion: 'Hindu' }));
    const json = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect('religion' in json).toBe(false);
  });

  it('showReligion=true → religion key IS PRESENT', () => {
    const result = toEmployerView(makeSource({ showReligion: true, religion: 'Hindu' }));
    const json = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect('religion' in json).toBe(true);
    expect(json['religion']).toBe('Hindu');
  });
});

// ── Section 2: dob never leaks; age is derived ────────────────────────────────

describe('toEmployerView — dob / age', () => {
  it('dob is ABSENT from the result object in ALL cases', () => {
    const result = toEmployerView(makeSource({ dob: new Date('1990-06-15') }));
    const json = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect('dob' in json).toBe(false);
  });

  it('dob=null → age is null; dob key still absent', () => {
    const result = toEmployerView(makeSource({ dob: null }));
    const json = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect('dob' in json).toBe(false);
    expect(json['age']).toBeNull();
  });

  it('age is present and correctly derived from dob', () => {
    // Born 1990-01-01; at any point after 2024-01-01 age >= 34
    const result = toEmployerView(makeSource({ dob: new Date('1990-01-01') }));
    const json = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect(typeof json['age']).toBe('number');
    expect(json['age'] as number).toBeGreaterThanOrEqual(34);
  });
});

// ── Section 3: toggle values never serialized ─────────────────────────────────

describe('toEmployerView — privacy toggle fields never exposed', () => {
  it('showPhone, showReligion, profileVisible keys are absent from output', () => {
    const result = toEmployerView(makeSource({ showPhone: true, showReligion: true }));
    const json = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect('showPhone' in json).toBe(false);
    expect('showReligion' in json).toBe(false);
    expect('profileVisible' in json).toBe(false);
  });

  it('userId and internal ids are absent (only id is kept for resource identity)', () => {
    const result = toEmployerView(makeSource());
    const json = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect('userId' in json).toBe(false);
  });
});

// ── Section 4: documentsStatus ────────────────────────────────────────────────

describe('toEmployerView — documentsStatus', () => {
  it('documents: [] → all mandatory types shown as uploaded:false', () => {
    const result = toEmployerView(makeSource({ documents: [] }));
    const json = JSON.parse(JSON.stringify(result)) as { documentsStatus: Record<string, unknown>[] };
    expect(Array.isArray(json.documentsStatus)).toBe(true);
    for (const entry of json.documentsStatus) {
      expect(entry['uploaded']).toBe(false);
      // No keys/URLs/fileNames
      expect('r2Key' in entry).toBe(false);
      expect('url' in entry).toBe(false);
      expect('fileName' in entry).toBe(false);
      expect('mimeType' in entry).toBe(false);
    }
  });

  it('passport with future expiryDate → uploaded:true, passportValid:true', () => {
    const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const result = toEmployerView(
      makeSource({
        documents: [{ type: DocumentType.PASSPORT, expiryDate: futureDate }],
      }),
    );
    const json = JSON.parse(JSON.stringify(result)) as { documentsStatus: Record<string, unknown>[] };
    const passport = json.documentsStatus.find((d) => d['type'] === 'PASSPORT');
    expect(passport).toBeDefined();
    expect(passport!['uploaded']).toBe(true);
    expect(passport!['passportValid']).toBe(true);
    // No r2Key/url/fileName even on an uploaded passport
    expect('r2Key' in passport!).toBe(false);
    expect('url' in passport!).toBe(false);
  });

  it('passport with past expiryDate → uploaded:true, passportValid:false', () => {
    const pastDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const result = toEmployerView(
      makeSource({
        documents: [{ type: DocumentType.PASSPORT, expiryDate: pastDate }],
      }),
    );
    const json = JSON.parse(JSON.stringify(result)) as { documentsStatus: Record<string, unknown>[] };
    const passport = json.documentsStatus.find((d) => d['type'] === 'PASSPORT');
    expect(passport!['passportValid']).toBe(false);
  });

  it('passport with null expiryDate → uploaded:true, passportValid:true (no expiry = valid)', () => {
    const result = toEmployerView(
      makeSource({
        documents: [{ type: DocumentType.PASSPORT, expiryDate: null }],
      }),
    );
    const json = JSON.parse(JSON.stringify(result)) as { documentsStatus: Record<string, unknown>[] };
    const passport = json.documentsStatus.find((d) => d['type'] === 'PASSPORT');
    expect(passport!['passportValid']).toBe(true);
  });

  it('non-passport documents do NOT have passportValid field', () => {
    const result = toEmployerView(
      makeSource({
        documents: [{ type: DocumentType.EXPERIENCE_CERT, expiryDate: null }],
      }),
    );
    const json = JSON.parse(JSON.stringify(result)) as { documentsStatus: Record<string, unknown>[] };
    const cert = json.documentsStatus.find((d) => d['type'] === 'EXPERIENCE_CERT');
    expect(cert!['uploaded']).toBe(true);
    expect('passportValid' in cert!).toBe(false);
  });
});

// ── Section 5: Salary expectation shape ──────────────────────────────────────

describe('toEmployerView — salaryExpectation', () => {
  it('both null → salaryExpectation is null (not an empty object)', () => {
    const result = toEmployerView(
      makeSource({ salaryExpectationMin: null, salaryExpectationMax: null }),
    );
    expect(result.salaryExpectation).toBeNull();
  });

  it('min set → salaryExpectation present with min', () => {
    const result = toEmployerView(makeSource({ salaryExpectationMin: 50000, salaryExpectationMax: null }));
    expect(result.salaryExpectation).not.toBeNull();
    expect(result.salaryExpectation!.min).toBe(50000);
  });
});

// ── Section 6: Browse card — structural absence of sensitive fields ────────────

describe('toBrowseCard — phone/religion/salary/documents absent by construction', () => {
  // Browse card mapper is tested by importing directly
  it('browse card has no phone, religion, salary, or documents keys', async () => {
    const { toBrowseCard } = await import('./candidate-browse-card.mapper');
    const card = toBrowseCard({
      id: 'c1',
      fullName: 'Ravi',
      photoUrl: null,
      jobCategoryId: 'cat-1',
      currentLocation: 'Mumbai',
      totalExperienceYears: 3.5,
      hasForeignExperience: false,
      skills: [{ name: 'Welding' }, { name: 'Fitting' }, { name: 'Grinding' }, { name: 'Extra' }],
      isAvailable: true,
      completionPct: 70,
      // CandidateBrowseSource fields
      photoKey: null,
      updatedAt: new Date(),
    });
    const json = JSON.parse(JSON.stringify(card)) as Record<string, unknown>;
    expect('phone' in json).toBe(false);
    expect('religion' in json).toBe(false);
    expect('salary' in json).toBe(false);
    expect('salaryExpectation' in json).toBe(false);
    expect('documents' in json).toBe(false);
    expect('documentsStatus' in json).toBe(false);
    // Skills capped at 3
    expect(json['skills']).toHaveLength(3);
  });
});
