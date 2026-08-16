import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { ContractDuration, Currency, EmploymentType, JobMarket } from '@prisma/client';
import { CreateJobDto, JOB_DESCRIPTION_MIN } from './dto/create-job.dto';
import { resolveContractDuration } from './jobs.service';

/** A description comfortably over the floor, so only the field under test fails. */
const LONG_DESCRIPTION = 'a'.repeat(JOB_DESCRIPTION_MIN + 50);

const VALID = {
  title: 'Mason',
  employmentType: EmploymentType.FULL_TIME,
  market: JobMarket.GULF,
  country: 'United Arab Emirates',
  location: 'Dubai',
  description: LONG_DESCRIPTION,
  categoryId: '3f4a1b2c-1111-2222-3333-444455556666',
  requirements: ['3 years experience'],
  salaryMin: 1000,
  salaryMax: 2000,
  currency: Currency.AED,
  accommodation: true,
  healthInsurance: true,
  transportation: true,
  foodAllowance: false,
  airTicketArrival: true,
  airTicketDeparture: true,
  hoursPerDay: 8,
  daysPerWeek: 6,
  overtime: false,
};

async function errorsFor(payload: unknown) {
  return validate(plainToInstance(CreateJobDto, payload) as object);
}

function fieldErrors(errors: Awaited<ReturnType<typeof errorsFor>>, property: string) {
  return errors.filter((e) => e.property === property);
}

describe('CreateJobDto — description floor', () => {
  it('accepts a description at and above the minimum', async () => {
    expect(
      fieldErrors(await errorsFor({ ...VALID, description: 'a'.repeat(JOB_DESCRIPTION_MIN) }), 'description'),
    ).toHaveLength(0);
  });

  /**
   * The rule this file exists for. A one-word description used to be accepted,
   * which is how "x" ended up as a perfectly valid job body in our own fixtures.
   */
  it('rejects a description one character short of the minimum', async () => {
    const errors = fieldErrors(
      await errorsFor({ ...VALID, description: 'a'.repeat(JOB_DESCRIPTION_MIN - 1) }),
      'description',
    );
    expect(errors[0]?.constraints).toHaveProperty('minLength');
  });

  it.each(['', 'x', 'Great job, apply now!'])('rejects the thin description %p', async (d) => {
    expect(fieldErrors(await errorsFor({ ...VALID, description: d }), 'description')).not.toHaveLength(
      0,
    );
  });

  it('still enforces the upper bound', async () => {
    const errors = fieldErrors(
      await errorsFor({ ...VALID, description: 'a'.repeat(15001) }),
      'description',
    );
    expect(errors[0]?.constraints).toHaveProperty('maxLength');
  });
});

describe('CreateJobDto — contractDuration shape', () => {
  it('accepts an omitted duration (the pairing rule lives in the service)', async () => {
    expect(fieldErrors(await errorsFor(VALID), 'contractDuration')).toHaveLength(0);
  });

  it('accepts every declared band', async () => {
    for (const value of Object.values(ContractDuration)) {
      expect(
        fieldErrors(await errorsFor({ ...VALID, contractDuration: value }), 'contractDuration'),
      ).toHaveLength(0);
    }
  });

  it.each(['6 months', 'MONTHS_3', 12])('rejects the invalid band %p', async (bad) => {
    expect(
      fieldErrors(await errorsFor({ ...VALID, contractDuration: bad }), 'contractDuration'),
    ).not.toHaveLength(0);
  });

  /**
   * `@IsOptional()` treats null exactly like an absent key, so an explicit null
   * passes the DTO and reaches the service — where it is falsy and therefore
   * handled as "no duration given". Worth pinning: a client that sends null to
   * mean "clear this" gets the same answer as one that omits the field.
   */
  it('treats an explicit null as "not provided", not as an invalid value', async () => {
    expect(
      fieldErrors(await errorsFor({ ...VALID, contractDuration: null }), 'contractDuration'),
    ).toHaveLength(0);
  });
});

/**
 * The employmentType/contractDuration pairing.
 *
 * class-validator sees one field at a time, so this cross-field rule is a plain
 * function in the service — which makes it directly testable without a DB.
 */
describe('resolveContractDuration', () => {
  it('returns the band for a contract role', () => {
    expect(resolveContractDuration(EmploymentType.CONTRACT, ContractDuration.YEARS_1_2)).toBe(
      ContractDuration.YEARS_1_2,
    );
  });

  it('refuses a contract role with no duration', () => {
    expect(() => resolveContractDuration(EmploymentType.CONTRACT, undefined)).toThrow(
      BadRequestException,
    );
  });

  it.each([EmploymentType.FULL_TIME, EmploymentType.PART_TIME])(
    'refuses a duration on a %s role',
    (type) => {
      expect(() => resolveContractDuration(type, ContractDuration.MONTHS_1_6)).toThrow(
        BadRequestException,
      );
    },
  );

  /**
   * NULL, not undefined — the difference decides whether switching a job away
   * from CONTRACT clears the stored band or silently leaves it attached to a job
   * that is no longer a contract.
   */
  it.each([EmploymentType.FULL_TIME, EmploymentType.PART_TIME])(
    'returns null (clearing any stored band) for a %s role',
    (type) => {
      expect(resolveContractDuration(type, undefined)).toBeNull();
    },
  );

  it('carries a machine-readable code on each refusal', () => {
    expect.assertions(2);
    try {
      resolveContractDuration(EmploymentType.CONTRACT, undefined);
    } catch (e) {
      expect((e as BadRequestException).getResponse()).toMatchObject({
        code: 'CONTRACT_DURATION_REQUIRED',
      });
    }
    try {
      resolveContractDuration(EmploymentType.FULL_TIME, ContractDuration.MONTHS_1_6);
    } catch (e) {
      expect((e as BadRequestException).getResponse()).toMatchObject({
        code: 'CONTRACT_DURATION_NOT_APPLICABLE',
      });
    }
  });
});
