import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { Currency } from '@prisma/client';

export class UpdateSettingsDto {
  @IsOptional()
  @IsBoolean()
  showPhone?: boolean;

  @IsOptional()
  @IsBoolean()
  showReligion?: boolean;

  @IsOptional()
  @IsBoolean()
  waNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  emailNotifs?: boolean;

  @IsOptional()
  @IsBoolean()
  profileVisible?: boolean;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryExpectationMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryExpectationMax?: number;

  @IsOptional()
  @IsEnum(Currency)
  salaryExpectationCurrency?: Currency;
}
