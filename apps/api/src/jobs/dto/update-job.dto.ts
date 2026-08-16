import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
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
import { JOB_DESCRIPTION_MIN } from './create-job.dto';

export class UpdateJobDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsOptional()
  @IsEnum(JobMarket)
  market?: JobMarket;

  @IsOptional()
  @IsString()
  @IsIn(ALL_JOB_COUNTRIES)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  location?: string;

  // Same floor as create — see JOB_DESCRIPTION_MIN. An edit must not be able to
  // whittle a published description back down below the bar it had to clear.
  @IsOptional()
  @IsString()
  @MinLength(JOB_DESCRIPTION_MIN)
  @MaxLength(15000)
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** See CreateJobDto — the category-pairing rule lives in JobsService. */
  @IsOptional()
  @IsString()
  @MaxLength(CATEGORY_OTHER_MAX_LENGTH)
  categoryOther?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requirements?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  experienceRequiredYears?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMax?: number;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsOptional()
  @IsBoolean()
  accommodation?: boolean;

  @IsOptional()
  @IsBoolean()
  healthInsurance?: boolean;

  @IsOptional()
  @IsBoolean()
  transportation?: boolean;

  @IsOptional()
  @IsBoolean()
  foodAllowance?: boolean;

  @IsOptional()
  @IsBoolean()
  airTicketArrival?: boolean;

  @IsOptional()
  @IsBoolean()
  airTicketDeparture?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  otherAllowance?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  hoursPerDay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  daysPerWeek?: number;

  @IsOptional()
  @IsBoolean()
  overtime?: boolean;

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

  // Paired with employmentType in JobsService, exactly as on create.
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
}
