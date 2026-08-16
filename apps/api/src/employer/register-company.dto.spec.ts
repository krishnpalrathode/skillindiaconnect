import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompanyType } from '@prisma/client';
import { RegisterCompanyDto } from './dto/register-company.dto';

/** Fast unit test — the registration-number optionality contract, no container. */
describe('RegisterCompanyDto validation', () => {
  const VALID = {
    name: 'Acme Recruit',
    type: CompanyType.LOCAL,
    industryType: 'Construction',
    phoneCode: '+91',
    phone: '9876543210',
    country: 'India',
    location: 'Mumbai',
    employeeRange: '50-200',
  };

  async function errorsFor(payload: unknown) {
    const dto = plainToInstance(RegisterCompanyDto, payload);
    return validate(dto as object);
  }

  function fieldErrors(errors: Awaited<ReturnType<typeof errorsFor>>, property: string) {
    return errors.filter((e) => e.property === property);
  }

  it('accepts a payload with NO registrationNumber', async () => {
    expect(await errorsFor(VALID)).toHaveLength(0);
  });

  it('accepts an explicitly undefined registrationNumber', async () => {
    expect(await errorsFor({ ...VALID, registrationNumber: undefined })).toHaveLength(0);
  });

  it('still accepts a supplied registrationNumber', async () => {
    expect(await errorsFor({ ...VALID, registrationNumber: 'REG123' })).toHaveLength(0);
  });

  it('rejects an empty-string registrationNumber — omit the field instead', async () => {
    const errors = fieldErrors(
      await errorsFor({ ...VALID, registrationNumber: '' }),
      'registrationNumber',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('isNotEmpty');
  });

  it('still enforces the 100-char ceiling when one IS supplied', async () => {
    const errors = fieldErrors(
      await errorsFor({ ...VALID, registrationNumber: 'a'.repeat(101) }),
      'registrationNumber',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('maxLength');
  });

  it('does not make the genuinely required fields optional', async () => {
    const errors = await errorsFor({ registrationNumber: 'REG123' });
    const properties = errors.map((e) => e.property);
    expect(properties).toEqual(
      expect.arrayContaining([
        'name',
        'type',
        'industryType',
        'phoneCode',
        'phone',
        'country',
        'location',
      ]),
    );
  });
});

describe('RegisterCompanyDto — company name rules', () => {
  const VALID = {
    type: CompanyType.LOCAL,
    industryType: 'Construction',
    phoneCode: '+91',
    phone: '9876543210',
    country: 'India',
    location: 'Mumbai',
    employeeRange: '50-200',
  };

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
  const VALID = {
    name: 'Acme Recruit',
    type: CompanyType.LOCAL,
    industryType: 'Construction',
    phone: '9876543210',
    country: 'India',
    location: 'Mumbai',
    employeeRange: '50-200',
  };

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
