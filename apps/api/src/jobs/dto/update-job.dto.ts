import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Currency, EmploymentType, JobMarket } from '@prisma/client';

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
  @MaxLength(500)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(15000)
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

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
