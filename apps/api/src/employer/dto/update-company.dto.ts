import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Validate,
} from 'class-validator';
import {
  COMPANY_COUNTRY_MAX,
  COMPANY_NAME_HAS_ALNUM,
  COMPANY_NAME_MAX,
  COMPANY_NAME_MESSAGE,
  PHONE_CODE_MESSAGE,
  PHONE_CODE_PATTERN,
} from './company-name.validator';
import { IsFoundedYearConstraint } from './founded-year.validator';

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(COMPANY_NAME_MAX)
  @Matches(COMPANY_NAME_HAS_ALNUM, { message: COMPANY_NAME_MESSAGE })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  industryType?: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE_CODE_PATTERN, { message: PHONE_CODE_MESSAGE })
  phoneCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(COMPANY_COUNTRY_MAX)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(300)
  website?: string;

  /**
   * Optional HERE, required on register — and that is not an inconsistency.
   * PATCH is a partial update of a company that already exists, so an absent key
   * means "leave it alone", not "blank it". Requiring every field on PATCH would
   * force every caller that changes one thing to resend the whole profile.
   */
  @IsOptional()
  @IsInt()
  @Validate(IsFoundedYearConstraint)
  foundedYear?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  employeeRange?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languagePref?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
