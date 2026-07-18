import { IsBoolean, IsIn, IsOptional } from 'class-validator';

/**
 * PARTIAL ResumeSettings (S7-0). Every field optional — omitted toggles keep
 * their stored value.
 *
 * `language` is restricted to 'en' because English is the ONLY language the
 * renderer has (S7-B1). Rejecting hi/ar here — rather than accepting them and
 * quietly rendering English — is the honest contract: a client cannot ask for
 * something that will not happen. When a translated template ships, this list
 * and the OpenAPI enum widen together.
 */
export class UpdateResumeSettingsDto {
  @IsOptional()
  @IsIn(['en'], { message: 'Only English resumes are available right now.' })
  language?: string;

  @IsOptional()
  @IsBoolean()
  showPhone?: boolean;

  @IsOptional()
  @IsBoolean()
  showReligion?: boolean;

  @IsOptional()
  @IsBoolean()
  showFatherName?: boolean;

  @IsOptional()
  @IsBoolean()
  showPassportNumber?: boolean;
}
