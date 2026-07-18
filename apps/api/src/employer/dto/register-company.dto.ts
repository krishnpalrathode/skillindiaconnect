import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { CompanyType } from '@prisma/client';

export class RegisterCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
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

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  location!: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(300)
  website?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  employeeRange!: string;

  // Contract: single optional locale string (default 'en'); stored as an
  // array on the Company row. The web form omits it entirely.
  @IsOptional()
  @IsIn(['en', 'hi', 'ar'])
  languagePref?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  // R2 key from the PRE-registration presign→PUT flow (Screen 14 initial
  // mode) — validated against the caller's `employer-reg/{userId}/cert/`
  // prefix and HEAD-checked in register().
  @IsOptional()
  @IsString()
  @MaxLength(512)
  registrationCertKey?: string;
}
