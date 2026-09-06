import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Admin creates a job-category row. `slug` is the STABLE machine key — the
 * employer post-a-job form keys the special "Other" branch off `slug === 'other'`
 * — so it is set once here and never editable afterwards (see UpdateJobCategoryDto,
 * which omits it). Names are the localized display strings; EN is required, HI/AR
 * optional and fall back to EN in the UI.
 */
export class CreateJobCategoryDto {
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase alphanumeric words separated by single hyphens',
  })
  @MaxLength(50)
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  nameEn!: string;

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
