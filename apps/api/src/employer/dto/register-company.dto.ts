import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import { CompanyType } from '@prisma/client';
import {
  COMPANY_COUNTRY_MAX,
  COMPANY_NAME_HAS_ALNUM,
  COMPANY_NAME_MAX,
  COMPANY_NAME_MESSAGE,
  PHONE_CODE_MESSAGE,
  PHONE_CODE_PATTERN,
} from './company-name.validator';

export class RegisterCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(COMPANY_NAME_MAX)
  @Matches(COMPANY_NAME_HAS_ALNUM, { message: COMPANY_NAME_MESSAGE })
  name!: string;

  @IsEnum(CompanyType)
  type!: CompanyType;

  // Optional: not every small employer has a registration number to hand at
  // sign-up. Admins still see it (or "—") during review, and the uploaded
  // registration certificate remains the mandatory proof.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  registrationNumber?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  industryType!: string;

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
