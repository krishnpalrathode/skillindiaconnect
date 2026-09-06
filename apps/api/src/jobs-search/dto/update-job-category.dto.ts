import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Admin edits a job category. `slug` is deliberately absent — it is a stable
 * identifier that consumers (the employer form's "Other" branch) depend on, so
 * it cannot be changed after creation. An empty string for a translation clears
 * it (the service normalizes '' → null).
 */
export class UpdateJobCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameHi?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameAr?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
