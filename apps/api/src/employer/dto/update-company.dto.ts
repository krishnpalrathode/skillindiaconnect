import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  COMPANY_COUNTRY_MAX,
  COMPANY_NAME_HAS_ALNUM,
  COMPANY_NAME_MAX,
  COMPANY_NAME_MESSAGE,
  PHONE_CODE_MESSAGE,
  PHONE_CODE_PATTERN,
} from './company-name.validator';

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
