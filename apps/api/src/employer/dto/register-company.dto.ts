import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Validate,
} from 'class-validator';
import { CompanyType } from '@prisma/client';
import { SUPPORTED_LOCALES } from '../../core/locales';
import {
  COMPANY_COUNTRY_MAX,
  COMPANY_NAME_HAS_ALNUM,
  COMPANY_NAME_MAX,
  COMPANY_NAME_MESSAGE,
  PHONE_CODE_MESSAGE,
  PHONE_CODE_PATTERN,
} from './company-name.validator';
import { IsFoundedYearConstraint } from './founded-year.validator';

/**
 * Registration is now a COMPLETE company profile.
 *
 * Every field the onboarding form shows is required here, not just in the form.
 * The previous split — registration number, website and description optional on
 * the server, "optional" in the UI — meant an employer could reach admin review
 * with a profile the reviewer could not actually assess, and it let the two
 * layers disagree about what a valid company is. The UI is a convenience; this
 * class is the rule.
 *
 * `languagePref` stays optional: it is not on the form, it has a server default
 * ('en'), and it describes a preference rather than a fact about the company.
 */
export class RegisterCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(COMPANY_NAME_MAX)
  @Matches(COMPANY_NAME_HAS_ALNUM, { message: COMPANY_NAME_MESSAGE })
  name!: string;

  @IsEnum(CompanyType)
  type!: CompanyType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  registrationNumber!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  industryType!: string;

  /**
   * Year of incorporation. Validated by a constraint that recomputes "this year"
   * per request — see founded-year.validator.ts for why a `@Max` constant is
   * wrong here. `@IsInt` runs first so a string year fails as a type error
   * rather than reaching the range check.
   */
  @IsInt()
  @Validate(IsFoundedYearConstraint)
  foundedYear!: number;

  @IsString()
  @IsNotEmpty()
  @Matches(PHONE_CODE_PATTERN, { message: PHONE_CODE_MESSAGE })
  phoneCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(COMPANY_COUNTRY_MAX)
  country!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  location!: string;

  @IsUrl()
  @MaxLength(300)
  website!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  employeeRange!: string;

  // Contract: single optional locale string (default 'en'); stored as an
  // array on the Company row. The web form omits it entirely.
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES as unknown as string[])
  languagePref?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;

  /**
   * R2 key from the PRE-registration presign→PUT flow (Screen 14 initial mode)
   * — validated against the caller's `employer-reg/{userId}/cert/` prefix and
   * HEAD-checked in register().
   *
   * Required. The certificate has always BEEN the mandatory proof of a real
   * company — the form has refused to submit without one since S2 — but the
   * server accepted a registration with no certificate at all, which is the
   * exact shape of an approval queue filling with unverifiable companies.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  registrationCertKey!: string;
}
