import {
  IsArray,
  IsBoolean,
  IsEnum,
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

export class CreateJobDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsEnum(EmploymentType)
  employmentType!: EmploymentType;

  @IsEnum(JobMarket)
  market!: JobMarket;

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
