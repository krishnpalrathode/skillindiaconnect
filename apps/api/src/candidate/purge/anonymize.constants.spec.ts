import { Prisma } from '@prisma/client';
import {
  CANDIDATE_PROFILE_ANONYMIZED_FIELDS,
  CANDIDATE_PROFILE_KEPT_FIELDS,
  USER_KEPT_FIELDS,
  applicationTombstoneFields,
  purgedEmail,
  userAnonymizedFields,
  PURGED_FULL_NAME,
} from './anonymize.constants';

/**
 * THE REVIEW-TEST for the erasure map (S6b-B1).
 *
 * How the map stays honest: this spec walks Prisma's DMMF (the schema's runtime
 * metadata) and requires EVERY scalar/enum column of the purge-anonymized
 * models to be classified — either in the anonymize map or in the explicit
 * KEPT allowlist (which carries a reason per field). Add a column to
 * candidate_profiles or users without deciding its purge fate and this test
 * fails the build. A new PII column can never silently survive a purge.
 */

function scalarFieldNames(modelName: string): string[] {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  if (!model) throw new Error(`model ${modelName} not in DMMF`);
  return model.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum').map((f) => f.name);
}

describe('anonymize.constants — the erasure map covers the whole schema surface', () => {
  it('every CandidateProfile column is classified (anonymized or explicitly kept)', () => {
    const classified = new Set([
      ...Object.keys(CANDIDATE_PROFILE_ANONYMIZED_FIELDS),
      ...Object.keys(CANDIDATE_PROFILE_KEPT_FIELDS),
    ]);
    for (const field of scalarFieldNames('CandidateProfile')) {
      expect(classified).toContain(field);
    }
  });

  it('every User column is classified (anonymized or explicitly kept)', () => {
    const classified = new Set([
      ...Object.keys(userAnonymizedFields('u-1', new Date())),
      ...Object.keys(USER_KEPT_FIELDS),
    ]);
    for (const field of scalarFieldNames('User')) {
      expect(classified).toContain(field);
    }
  });

  it('no field is in BOTH the anonymize map and the kept list (one fate per column)', () => {
    const anonymized = Object.keys(CANDIDATE_PROFILE_ANONYMIZED_FIELDS);
    for (const field of anonymized) {
      expect(CANDIDATE_PROFILE_KEPT_FIELDS[field]).toBeUndefined();
    }
    const userAnonymized = Object.keys(userAnonymizedFields('u-1', new Date()));
    for (const field of userAnonymized) {
      expect(USER_KEPT_FIELDS[field]).toBeUndefined();
    }
  });

  it('the known PII columns are all ERASED, never kept', () => {
    const map = CANDIDATE_PROFILE_ANONYMIZED_FIELDS as Record<string, unknown>;
    // The candidate-surface PII list — assert each is mapped to an erasing value.
    for (const pii of [
      'fatherName',
      'dob',
      'phone',
      'religion',
      'maritalStatus',
      'currentLocation',
      'nationality',
      'photoKey',
      'videoR2Key',
      'salaryExpectationMin',
      'salaryExpectationMax',
    ]) {
      expect(map).toHaveProperty(pii);
      expect(map[pii]).toBeNull();
    }
    expect(map['fullName']).toBe(PURGED_FULL_NAME);
    expect(map['languages']).toEqual([]);
    expect(map['profileVisible']).toBe(false);
  });
});

describe('the email tombstone', () => {
  it('is collision-free (keyed by the unique userId) and non-routable (.invalid TLD)', () => {
    const a = purgedEmail('11111111-1111-4111-8111-111111111111');
    const b = purgedEmail('22222222-2222-4222-8222-222222222222');
    expect(a).not.toBe(b);
    expect(a.endsWith('@deleted.invalid')).toBe(true);
    // Never a real, deliverable address shape on a routable domain.
    expect(a).toMatch(/^purged-[0-9a-f-]+@deleted\.invalid$/);
  });

  it('is non-reversible — contains nothing derived from the original address', () => {
    const value = purgedEmail('some-user-id');
    expect(value).toBe('purged-some-user-id@deleted.invalid');
  });
});

describe('the application tombstone', () => {
  it('nulls the candidate link + free text and carries a PII-free marker', () => {
    const now = new Date('2026-07-14T00:00:00Z');
    const fields = applicationTombstoneFields(now);
    expect(fields.candidateId).toBeNull();
    expect(fields.coverLetter).toBeNull();
    expect(fields.rejectionFeedback).toBeNull();
    expect(fields.candidateTombstone).toEqual({ purged: true, at: now.toISOString() });
    // It NEVER touches the employer's hiring record.
    for (const kept of ['status', 'matchScore', 'matchBreakdown', 'docsCompleteCount']) {
      expect(fields).not.toHaveProperty(kept);
    }
  });
});
