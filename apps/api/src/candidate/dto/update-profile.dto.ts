import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SUMMARY_MAX_LENGTH } from '../candidate.constants';
import { MaritalStatus } from '@prisma/client';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  fatherName?: string;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsEnum(MaritalStatus)
  maritalStatus?: MaritalStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  religion?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @IsOptional()
  @IsUUID()
  jobCategoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentLocation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nationality?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  noticePeriod?: number;

  /**
   * Resume intro. Trimmed-empty is allowed and means "remove it" — a candidate
   * clearing the box must be able to take it off their resume, which a
   * required-non-empty rule would prevent.
   */
  @IsOptional()
  @IsString()
  @MaxLength(SUMMARY_MAX_LENGTH)
  summary?: string;
}
