import { describe, it, expect } from 'vitest';
import {
  CONTRACT_DURATIONS,
  DEFAULT_FORM_VALUES,
  JOB_DESCRIPTION_MIN,
  defaultCurrencyForMarket,
  formToPayload,
  formToPreview,
  getCurrenciesForMarket,
  validateJobForm,
  type JobFormValues,
} from '../jobFormState';

/** A form filled well enough that only the field under test can fail. */
function completeValues(overrides: Partial<JobFormValues> = {}): JobFormValues {
  return {
    ...DEFAULT_FORM_VALUES,
    title: 'Welder',
    country: 'United Arab Emirates',
    categoryId: 'cat-1',
    location: 'Dubai',
    description: 'a'.repeat(JOB_DESCRIPTION_MIN),
    salaryMin: '1000',
    salaryMax: '2000',
    ...overrides,
  };
}

describe('validateJobForm — description floor', () => {
  it('accepts a description exactly at the minimum', () => {
    expect(validateJobForm(completeValues()).description).toBeUndefined();
  });

  it('rejects one character short, and says how many are still needed', () => {
    const errors = validateJobForm(
      completeValues({ description: 'a'.repeat(JOB_DESCRIPTION_MIN - 40) }),
    );
    expect(errors.description).toContain(String(JOB_DESCRIPTION_MIN));
    // The actionable half: the shortfall, not just the rule.
    expect(errors.description).toContain('40');
  });

  it('measures the TRIMMED length — padding with spaces is not writing', () => {
    const padded = `${'a'.repeat(10)}${' '.repeat(400)}`;
    expect(validateJobForm(completeValues({ description: padded })).description).toBeDefined();
  });

  it('still reports an empty description as simply required', () => {
    expect(validateJobForm(completeValues({ description: '   ' })).description).toBe(
      'Job description is required',
    );
  });
});

describe('validateJobForm — contract duration pairing', () => {
  it('requires a duration when the role is a contract', () => {
    const errors = validateJobForm(
      completeValues({ employmentType: 'CONTRACT', contractDuration: '' }),
    );
    expect(errors.contractDuration).toBeDefined();
  });

  it('accepts a contract role once a band is chosen', () => {
    const errors = validateJobForm(
      completeValues({ employmentType: 'CONTRACT', contractDuration: 'YEARS_1_2' }),
    );
    expect(errors.contractDuration).toBeUndefined();
  });

  it.each(['FULL_TIME', 'PART_TIME'] as const)('does not ask a %s role for a duration', (type) => {
    expect(
      validateJobForm(completeValues({ employmentType: type })).contractDuration,
    ).toBeUndefined();
  });
});

describe('formToPayload — contract duration', () => {
  it('sends the band for a contract role', () => {
    const payload = formToPayload(
      completeValues({ employmentType: 'CONTRACT', contractDuration: 'MONTHS_6_12' }),
    );
    expect(payload.contractDuration).toBe('MONTHS_6_12');
  });

  /**
   * The server rejects a duration on a non-contract job, so the key must be
   * ABSENT — not null, not an empty string. A stale value left over from a
   * dropdown the employer changed their mind about would become a 400.
   */
  it.each(['FULL_TIME', 'PART_TIME'] as const)('omits the key entirely for a %s role', (type) => {
    const payload = formToPayload(
      completeValues({ employmentType: type, contractDuration: 'YEARS_2_5' }),
    );
    expect('contractDuration' in payload).toBe(false);
  });
});

describe('currency options', () => {
  /**
   * The form used to offer six GCC codes on a Gulf job and INR alone on a local
   * one, which is narrower than the API's Currency enum has been for a while.
   */
  it('offers the same full list regardless of market', () => {
    const gulf = getCurrenciesForMarket('GULF');
    const local = getCurrenciesForMarket('LOCAL');
    expect(gulf).toEqual(local);
    expect(gulf.length).toBeGreaterThan(6);
  });

  it('includes both the GCC corridor and the wider markets', () => {
    const codes = getCurrenciesForMarket('GULF');
    for (const code of ['INR', 'AED', 'SAR', 'QAR', 'OMR', 'KWD', 'BHD', 'USD', 'EUR', 'GBP']) {
      expect(codes).toContain(code);
    }
  });

  it('still defaults by corridor — the market picks the default, not the list', () => {
    expect(defaultCurrencyForMarket('GULF')).toBe('AED');
    expect(defaultCurrencyForMarket('LOCAL')).toBe('INR');
  });

  it('every offered code is one the API enum accepts', () => {
    // Mirrors the Currency enum in schema.prisma; an option missing there fails
    // on save, which is exactly how USD once broke the candidate settings form.
    const accepted = [
      'INR',
      'QAR',
      'AED',
      'SAR',
      'OMR',
      'KWD',
      'BHD',
      'USD',
      'EUR',
      'GBP',
      'CAD',
      'AUD',
      'SGD',
      'JPY',
      'MYR',
    ];
    for (const code of getCurrenciesForMarket('GULF')) expect(accepted).toContain(code);
  });
});

describe('CONTRACT_DURATIONS', () => {
  it('lists the four bands in ascending order', () => {
    expect(CONTRACT_DURATIONS.map((d) => d.value)).toEqual([
      'MONTHS_1_6',
      'MONTHS_6_12',
      'YEARS_1_2',
      'YEARS_2_5',
    ]);
  });

  it('gives every band human copy', () => {
    for (const d of CONTRACT_DURATIONS) expect(d.label).toMatch(/month|year/);
  });
});

describe('worker protections follow the market', () => {
  /**
   * The three guarantees are for workers who EMIGRATE for the job. A domestic
   * role has no such dependency, so they became opt-in there — and the payload
   * has to carry what the employer actually said, not a hardcoded true.
   */
  it('sends the real values, not a hardcoded true', () => {
    const payload = formToPayload(
      completeValues({
        market: 'LOCAL',
        country: 'India',
        accommodation: false,
        healthInsurance: false,
        transportation: false,
      }),
    );
    expect(payload.accommodation).toBe(false);
    expect(payload.healthInsurance).toBe(false);
    expect(payload.transportation).toBe(false);
  });

  it('still carries them through when an employer does offer them', () => {
    const payload = formToPayload(
      completeValues({
        market: 'LOCAL',
        country: 'India',
        accommodation: true,
        healthInsurance: false,
        transportation: true,
      }),
    );
    expect(payload.accommodation).toBe(true);
    expect(payload.healthInsurance).toBe(false);
    expect(payload.transportation).toBe(true);
  });

  // The live preview must not show three permanent green chips for a job that
  // provides none of them — the preview is what the employer trusts.
  it('the preview reflects the real state', () => {
    const preview = formToPreview(
      completeValues({ market: 'LOCAL', country: 'India', accommodation: false }),
      'Acme',
    );
    expect(preview.accommodation).toBe(false);
  });
});
