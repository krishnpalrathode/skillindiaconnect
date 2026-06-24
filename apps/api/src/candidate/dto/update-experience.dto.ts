import { IsDateString, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ExperienceType } from '@prisma/client';

export class UpdateExperienceDto {
  @IsOptional()
  @IsEnum(ExperienceType)
  type?: ExperienceType;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  role?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  years?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  months?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
