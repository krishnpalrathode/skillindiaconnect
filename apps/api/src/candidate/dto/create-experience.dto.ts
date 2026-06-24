import { IsDateString, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ExperienceType } from '@prisma/client';

export class CreateExperienceDto {
  @IsEnum(ExperienceType)
  type!: ExperienceType;

  @IsString()
  @MaxLength(100)
  country!: string;

  @IsString()
  @MaxLength(200)
  companyName!: string;

  @IsString()
  @MaxLength(200)
  role!: string;

  @IsInt()
  @Min(0)
  years!: number;

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
