import {
  IsArray,
  IsEnum,
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

  @IsArray()
  @IsString({ each: true })
  languagePref!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
