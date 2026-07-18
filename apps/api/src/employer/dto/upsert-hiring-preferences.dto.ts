import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertHiringPreferencesDto {
  /** Category IDs (UUIDs) the employer prefers to hire from. Validated against job_categories. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(20)
  preferredCategories?: string[];

  /** Preferred candidate nationalities (e.g. 'Indian', 'Nepali'). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  preferredNationalities?: string[];

  /** Minimum years of experience preferred. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  minExperience?: number;

  /**
   * Free-text hiring notes.
   * Accepted in input but not currently persisted (no DB column in migration 0000).
   * Reserved for a future schema expansion.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
