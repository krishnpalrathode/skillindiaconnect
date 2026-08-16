import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ContractDuration, Currency, EmploymentType, JobMarket } from '@prisma/client';
import { ALL_JOB_COUNTRIES } from '../job-countries';
import { CATEGORY_OTHER_MAX_LENGTH } from '../../core/job-categories';
import { JOB_POSTING_TERMS_HISTORY } from '../job-posting-terms';

/**
 * Minimum length of a job description, in characters.
 *
 * Exported so the web form, the update DTO and the OpenAPI contract all state
 * the SAME number — three copies of `300` drift the moment one is tuned.
 */
export const JOB_DESCRIPTION_MIN = 300;

export class CreateJobDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsEnum(EmploymentType)
  employmentType!: EmploymentType;

  @IsEnum(JobMarket)
  market!: JobMarket;

  // Canonical English country name; must match `market` (India for LOCAL, a GCC
  // state for GULF) — that cross-field rule is enforced in the service.
  @IsString()
  @IsNotEmpty()
  @IsIn(ALL_JOB_COUNTRIES)
  country!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  location!: string;

  /**
   * A real description, not a placeholder.
   *
   * 300 characters is roughly three sentences — enough to say what the work is,
   * where, and what the candidate needs. The floor applies at CREATE, so it
   * catches a thin description while the employer is still on the form, rather
   * than at publish where the error arrives detached from the field that caused
   * it. It does mean a draft cannot be saved with two words in this box; that is
   * consistent with the rest of the form, which already requires title, country,
   * category, location, salary and hours before a draft will save.
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(JOB_DESCRIPTION_MIN)
  @MaxLength(15000)
  description!: string;

  @IsUUID()
  categoryId!: string;

  /**
   * Free-text trade, required when `categoryId` points at the `other` category
   * and rejected otherwise. The pairing rule needs the category ROW (to read
   * its slug), which class-validator cannot fetch — so it is enforced in
   * JobsService, not here. This only bounds the string.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(CATEGORY_OTHER_MAX_LENGTH)
  categoryOther?: string;

  @IsArray()
  @IsString({ each: true })
  requirements!: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  experienceRequiredYears?: number;

  @IsInt()
  @Min(0)
  salaryMin!: number;

  @IsInt()
  @Min(0)
  salaryMax!: number;

  @IsEnum(Currency)
  currency!: Currency;

  @IsBoolean()
  accommodation!: boolean;

  @IsBoolean()
  healthInsurance!: boolean;

  @IsBoolean()
  transportation!: boolean;

  @IsBoolean()
  foodAllowance!: boolean;

  @IsBoolean()
  airTicketArrival!: boolean;

  @IsBoolean()
  airTicketDeparture!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  otherAllowance?: string;

  @IsInt()
  @Min(1)
  @Max(24)
  hoursPerDay!: number;

  @IsInt()
  @Min(1)
  @Max(7)
  daysPerWeek!: number;

  @IsBoolean()
  overtime!: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  overtimeRateSubunits?: number;

  /** @deprecated Never collected by any form; use `contractDuration`. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  contractPeriodMonths?: number;

  /**
   * Optional HERE and paired in the service: it is REQUIRED when
   * `employmentType` is CONTRACT and REJECTED otherwise.
   *
   * class-validator sees one field at a time, so a cross-field rule expressed
   * here would either be unenforceable or would have to duplicate the
   * employment-type check in a custom constraint. JobsService already owns the
   * comparable category/categoryOther pairing; this lives beside it.
   */
  @IsOptional()
  @IsEnum(ContractDuration)
  contractDuration?: ContractDuration;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  vacancies?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  genderPreference?: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsBoolean()
  isUrgent?: boolean;

  /**
   * The job-posting terms the employer ticked, BY VERSION.
   *
   * Required, and validated against the published versions rather than merely
   * being a non-empty string — a client sending `"yes"` or an invented version
   * would otherwise produce a job whose acceptance record points at nothing.
   *
   * Accepts any PUBLISHED version, not only the current one: a form loaded five
   * minutes before a terms update should not fail on submit with an error the
   * employer cannot act on. JobsService stamps what was actually accepted.
   */
  @IsString()
  @IsIn(JOB_POSTING_TERMS_HISTORY as unknown as string[])
  acceptedTermsVersion!: string;
}
