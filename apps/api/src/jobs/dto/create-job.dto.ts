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
} from 'class-validator';
import { Currency, EmploymentType, JobMarket } from '@prisma/client';
import { ALL_JOB_COUNTRIES } from '../job-countries';
import { CATEGORY_OTHER_MAX_LENGTH } from '../../core/job-categories';

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

  @IsString()
  @IsNotEmpty()
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

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  contractPeriodMonths?: number;

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
}
