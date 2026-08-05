import { ResumeTemplate } from '@prisma/client';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

/**
 * The templates the API ACCEPTS — deliberately narrower than the database enum.
 *
 * `ResumeTemplate` declares all four so B2 needs no enum migration, but only
 * CLASSIC has a renderer today. Accepting MODERN here would store a value that
 * silently renders as CLASSIC, which is precisely what the `language` field
 * below refuses to do with hi/ar. B2 widens this list as it ships the renderers.
 */
export const ACCEPTED_RESUME_TEMPLATES: ResumeTemplate[] = [ResumeTemplate.CLASSIC];

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

  @IsOptional()
  @IsIn(ACCEPTED_RESUME_TEMPLATES, {
    message: 'That resume template is not available yet.',
  })
  template?: ResumeTemplate;
}
