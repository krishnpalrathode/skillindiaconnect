import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompanyType } from '@prisma/client';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { FOUNDED_YEAR_MIN } from './dto/founded-year.validator';

/**
 * A registration payload with every field the onboarding form collects.
 *
 * Kept complete on purpose: each test below removes or corrupts ONE key, so a
 * failure names the field that broke rather than a pile of unrelated errors.
 */
const VALID = {
  name: 'Acme Recruit',
  type: CompanyType.LOCAL,
  registrationNumber: 'REG123',
  industryType: 'Construction',
  foundedYear: 2014,
  phoneCode: '+91',
  phone: '9876543210',
  country: 'India',
  location: 'Mumbai',
  website: 'https://acme.example',
  employeeRange: '50-200',
  description: 'A test employer.',
  registrationCertKey: 'employer-reg/user-1/cert/reg.pdf',
};

async function errorsFor(payload: unknown) {
  const dto = plainToInstance(RegisterCompanyDto, payload);
  return validate(dto as object);
}

function fieldErrors(errors: Awaited<ReturnType<typeof errorsFor>>, property: string) {
  return errors.filter((e) => e.property === property);
}

describe('RegisterCompanyDto — every profile field is required', () => {
  it('accepts the complete payload', async () => {
    expect(await errorsFor(VALID)).toHaveLength(0);
  });

  /**
   * The rule this file exists to hold.
   *
   * Registration number, website and description used to be optional on the
   * server while the form presented them as ordinary fields, so an employer
   * could reach the approval queue with a profile a reviewer could not assess.
   * Each is now required HERE, not only in the UI — a client that skips the form
   * must not be able to skip the rule.
   */
  it.each([
    'name',
    'type',
    'registrationNumber',
    'industryType',
    'foundedYear',
    'phoneCode',
    'phone',
    'country',
    'location',
    'website',
    'employeeRange',
    'description',
    'registrationCertKey',
  ])('rejects a payload missing %s', async (field) => {
    // Copy-and-delete rather than destructuring the key away: the rest-sibling
    // form leaves a binding nobody reads, which this repo's no-unused-vars rule
    // rejects (its `^_` exemption covers arguments, not variables).
    const withoutField: Record<string, unknown> = { ...VALID };
    delete withoutField[field];
    expect(fieldErrors(await errorsFor(withoutField), field)).not.toHaveLength(0);
  });

  it.each(['registrationNumber', 'industryType', 'location', 'description'])(
    'rejects an empty-string %s — a blank is not an answer',
    async (field) => {
      const errors = fieldErrors(await errorsFor({ ...VALID, [field]: '' }), field);
      expect(errors[0]?.constraints).toHaveProperty('isNotEmpty');
    },
  );

  it('still enforces the 100-char ceiling on registrationNumber', async () => {
    const errors = fieldErrors(
      await errorsFor({ ...VALID, registrationNumber: 'a'.repeat(101) }),
      'registrationNumber',
    );
    expect(errors[0]?.constraints).toHaveProperty('maxLength');
  });

  it('requires website to be a real URL, not just non-empty', async () => {
    expect(fieldErrors(await errorsFor({ ...VALID, website: 'acme' }), 'website')).not.toHaveLength(
      0,
    );
    expect(
      fieldErrors(await errorsFor({ ...VALID, website: 'https://acme.example' }), 'website'),
    ).toHaveLength(0);
  });

  /**
   * The previous version of this test added `languagePref` to VALID and then
   * destructured it straight back off, so it asserted nothing the first test in
   * this file did not already cover. Optionality has two halves worth pinning —
   * absent is fine, and present-and-valid is fine — plus the bound that keeps it
   * from being a free-text field.
   */
  it('leaves languagePref optional — it is not on the form and has a server default', async () => {
    expect('languagePref' in VALID).toBe(false);
    expect(await errorsFor(VALID)).toHaveLength(0);
  });

  it('accepts a supported locale when one IS supplied', async () => {
    expect(fieldErrors(await errorsFor({ ...VALID, languagePref: 'hi' }), 'languagePref')).toHaveLength(
      0,
    );
  });

  it('rejects a locale the platform does not support', async () => {
    expect(
      fieldErrors(await errorsFor({ ...VALID, languagePref: 'xx' }), 'languagePref'),
    ).not.toHaveLength(0);
  });
});

describe('RegisterCompanyDto — foundedYear', () => {
  const thisYear = new Date().getUTCFullYear();

  it('accepts a plausible founding year', async () => {
    expect(fieldErrors(await errorsFor({ ...VALID, foundedYear: 1998 }), 'foundedYear')).toHaveLength(
      0,
    );
  });

  it('accepts the current year — a company founded this year is valid', async () => {
    expect(
      fieldErrors(await errorsFor({ ...VALID, foundedYear: thisYear }), 'foundedYear'),
    ).toHaveLength(0);
  });

  // The bound is recomputed per request rather than captured at module load, so
  // this holds on a process still running after New Year. See the validator.
  it('rejects a year in the future', async () => {
    expect(
      fieldErrors(await errorsFor({ ...VALID, foundedYear: thisYear + 1 }), 'foundedYear'),
    ).not.toHaveLength(0);
  });

  it(`accepts the ${FOUNDED_YEAR_MIN} floor but rejects the year below it`, async () => {
    expect(
      fieldErrors(await errorsFor({ ...VALID, foundedYear: FOUNDED_YEAR_MIN }), 'foundedYear'),
    ).toHaveLength(0);
    expect(
      fieldErrors(await errorsFor({ ...VALID, foundedYear: FOUNDED_YEAR_MIN - 1 }), 'foundedYear'),
    ).not.toHaveLength(0);
  });

  // The realistic typo: a truncated or mistyped year, not an ancient company.
  it.each([0, 19, 202, -2014])('rejects the malformed year %s', async (year) => {
    expect(
      fieldErrors(await errorsFor({ ...VALID, foundedYear: year }), 'foundedYear'),
    ).not.toHaveLength(0);
  });

  it.each([2014.5, '2014', null, 'nineteen ninety'])(
    'rejects a non-integer year: %s',
    async (year) => {
      expect(
        fieldErrors(await errorsFor({ ...VALID, foundedYear: year }), 'foundedYear'),
      ).not.toHaveLength(0);
    },
  );
});

describe('RegisterCompanyDto — company name rules', () => {
  async function nameErrors(name: unknown) {
    const dto = plainToInstance(RegisterCompanyDto, { ...VALID, name });
    return (await validate(dto as object)).filter((e) => e.property === 'name');
  }

  it('accepts a name at the 100-char boundary', async () => {
    expect(await nameErrors('a'.repeat(100))).toHaveLength(0);
  });

  it('rejects a name over 100 chars', async () => {
    const errors = await nameErrors('a'.repeat(101));
    expect(errors[0]?.constraints).toHaveProperty('maxLength');
  });

  it('accepts real names that exceed 20 chars', async () => {
    // Both of these exist in the seeded data — a 20-char cap would reject them.
    expect(await nameErrors('Gulf Star Contracting LLC')).toHaveLength(0);
    expect(await nameErrors('Sharma Builders Pvt Ltd')).toHaveLength(0);
  });

  it.each(['---', '@@@', '!!!', '***', '&&&', '.', '~'])(
    'rejects a name made only of special characters: %s',
    async (name) => {
      const errors = await nameErrors(name);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.constraints).toHaveProperty('matches');
    },
  );

  it('still allows punctuation INSIDE a real name', async () => {
    expect(await nameErrors('L&T Ltd.')).toHaveLength(0);
    expect(await nameErrors('S.K. Traders & Co.')).toHaveLength(0);
  });

  it('accepts non-Latin scripts — the rule is Unicode-aware', async () => {
    expect(await nameErrors('अजय बिल्डर्स')).toHaveLength(0);
    expect(await nameErrors('شركة النور')).toHaveLength(0);
  });
});

describe('RegisterCompanyDto — phoneCode rules', () => {
  async function codeErrors(phoneCode: unknown) {
    const dto = plainToInstance(RegisterCompanyDto, { ...VALID, phoneCode });
    return (await validate(dto as object)).filter((e) => e.property === 'phoneCode');
  }

  it.each(['+91', '+971', '+966', '+1'])('accepts dial code %s', async (code) => {
    expect(await codeErrors(code)).toHaveLength(0);
  });

  it.each(['91', '+', '+abc', '++91', '+912345'])('rejects malformed code %s', async (code) => {
    expect(await codeErrors(code)).not.toHaveLength(0);
  });
});
